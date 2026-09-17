import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { DistributionRequest, MachineDistribution } from "../auth/auth";
import { config } from "../common/config";
import { uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { DistributionService } from "./distribution.service";

type RpcId = string | number;

const MCP_PROTOCOL_VERSION = "2025-03-26";
const rpcId = z.union([z.string(), z.number()]);
const rpcRequest = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: rpcId.optional(),
    method: z.string().min(1).max(120),
    params: z.unknown().optional(),
  })
  .strict();
const rpcResponse = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: rpcId,
    result: z.unknown().optional(),
    error: z
      .object({ code: z.number().int(), message: z.string() })
      .passthrough()
      .optional(),
  })
  .strict()
  .refine(
    (value) => (value.result !== undefined) !== (value.error !== undefined),
    "JSON-RPC response needs exactly one result or error",
  );
const initializeInput = z
  .object({
    protocolVersion: z.string().min(1).max(80),
    capabilities: z.record(z.unknown()),
    clientInfo: z
      .object({
        name: z.string().min(1).max(160),
        version: z.string().min(1).max(80),
      })
      .passthrough(),
  })
  .passthrough();
const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{12,128}$/);
const toolCall = z
  .object({
    name: z.enum([
      "tome_distribution_list_handoffs",
      "tome_distribution_get_package",
      "tome_distribution_report_published",
      "tome_distribution_report_attention",
    ]),
    arguments: z.record(z.unknown()).default({}),
  })
  .strict();

function response(id: RpcId, result: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: RpcId | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function toolFailure(error: unknown) {
  if (error instanceof Fault) return error.getResponse();
  if (error instanceof z.ZodError)
    return {
      code: "INVALID_INPUT",
      message: error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .slice(0, 6)
        .join("；"),
    };
  return {
    code: "DISTRIBUTION_MCP_TOOL_FAILED",
    message: "标准分发交付工具执行失败",
  };
}

const toolDefinitions = [
  {
    name: "tome_distribution_list_handoffs",
    description: "列出当前渠道待交付或已交付给本会话的标准资料记录。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "tome_distribution_get_package",
    description:
      "取得一条冻结资料并标记为已交付；不会执行任何外部平台操作。",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        recordId: { type: "string" },
      },
      required: ["idempotencyKey", "recordId"],
      additionalProperties: false,
    },
  },
  {
    name: "tome_distribution_report_published",
    description:
      "回填目标操作已确认完成；稳定远端 ID 可选，禁止用伪造 ID 占位。",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        recordId: { type: "string" },
        note: { type: "string" },
        remoteId: { type: "string" },
        remoteUrl: { type: "string" },
      },
      required: ["idempotencyKey", "recordId", "note"],
      additionalProperties: false,
    },
  },
  {
    name: "tome_distribution_report_attention",
    description:
      "回填外部执行结果不明或需要处理；该记录随后只能人工核对。",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        recordId: { type: "string" },
        note: { type: "string" },
      },
      required: ["idempotencyKey", "recordId", "note"],
      additionalProperties: false,
    },
  },
] as const;

@ApiTags("标准分发交付 MCP")
@MachineDistribution()
@Controller("api/mcp")
export class DistributionMcpController {
  constructor(private distribution: DistributionService) {}

  @Post("distribution")
  @HttpCode(200)
  async handle(
    @Body() raw: unknown,
    @Req() request: DistributionRequest,
    @Res({ passthrough: true }) responseWriter: Response,
  ) {
    const origin = request.get("Origin");
    if (origin && origin !== config().origin)
      throw new Fault("MCP_ORIGIN_DENIED", "MCP 请求来源不匹配", 403);
    const batch = Array.isArray(raw);
    if (batch && raw.length === 0)
      return rpcError(null, -32600, "Invalid Request");
    const messages = batch ? raw : [raw];
    const replies = await Promise.all(
      messages.map((message) => this.handleMessage(message, request, batch)),
    );
    const results = replies.filter(
      (reply): reply is Record<string, unknown> => reply !== undefined,
    );
    if (!results.length) {
      responseWriter.status(202).end();
      return;
    }
    return batch ? results : results[0];
  }

  @Get("distribution")
  @ApiResponse({
    status: 405,
    description: "MCP endpoint does not provide an SSE stream; use POST.",
  })
  streamUnavailable(@Res() responseWriter: Response) {
    responseWriter.status(405).set("Allow", "POST").end();
  }

  private async handleMessage(
    raw: unknown,
    request: DistributionRequest,
    batch: boolean,
  ): Promise<Record<string, unknown> | undefined> {
    const parsed = rpcRequest.safeParse(raw);
    if (!parsed.success) {
      if (rpcResponse.safeParse(raw).success) return undefined;
      return rpcError(null, -32600, "Invalid Request");
    }
    if (parsed.data.id === undefined) return undefined;
    const id = parsed.data.id;
    if (parsed.data.method === "notifications/initialized")
      return rpcError(id, -32600, "Initialized notification must not include id");
    if (parsed.data.method === "initialize") {
      if (batch) return rpcError(id, -32600, "Initialize must not be batched");
      const initialization = initializeInput.safeParse(parsed.data.params);
      if (!initialization.success)
        return rpcError(id, -32602, "Invalid initialize params");
      return response(id, {
        protocolVersion:
          initialization.data.protocolVersion === MCP_PROTOCOL_VERSION
            ? initialization.data.protocolVersion
            : MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "tome-distribution", version: "1.0" },
        instructions:
          "Use only the four standard handoff tools. ToMe provides frozen material and records results; it does not perform external platform steps.",
      });
    }
    if (parsed.data.method === "tools/list")
      return response(id, { tools: toolDefinitions });
    if (parsed.data.method !== "tools/call")
      return rpcError(id, -32601, "Method not found");
    const call = toolCall.safeParse(parsed.data.params || {});
    if (!call.success) return rpcError(id, -32602, "Invalid params");
    try {
      return response(
        id,
        toolResult(
          await this.callTool(call.data.name, call.data.arguments, request),
        ),
      );
    } catch (error) {
      return response(id, toolResult(toolFailure(error), true));
    }
  }

  private async callTool(
    name: (typeof toolDefinitions)[number]["name"],
    args: Record<string, unknown>,
    request: DistributionRequest,
  ) {
    if (name === "tome_distribution_list_handoffs") {
      z.object({}).strict().parse(args);
      return this.distribution.handoffs(request.distributionSession);
    }
    if (name === "tome_distribution_get_package") {
      const input = z
        .object({ idempotencyKey, recordId: uuid })
        .strict()
        .parse(args);
      return this.distribution.handoffPackage(
        request.distributionSession,
        input.idempotencyKey,
        input.recordId,
      );
    }
    if (name === "tome_distribution_report_published") {
      const input = z
        .object({
          idempotencyKey,
          recordId: uuid,
          note: z.string(),
          remoteId: z.string().optional(),
          remoteUrl: z.string().optional(),
        })
        .strict()
        .parse(args);
      return this.distribution.reportHandoffPublished(
        request.distributionSession,
        input.idempotencyKey,
        input.recordId,
        {
          note: input.note,
          ...(input.remoteId === undefined ? {} : { remoteId: input.remoteId }),
          ...(input.remoteUrl === undefined
            ? {}
            : { remoteUrl: input.remoteUrl }),
        },
      );
    }
    const input = z
      .object({ idempotencyKey, recordId: uuid, note: z.string() })
      .strict()
      .parse(args);
    return this.distribution.reportHandoffAttention(
      request.distributionSession,
      input.idempotencyKey,
      input.recordId,
      { note: input.note },
    );
  }
}
