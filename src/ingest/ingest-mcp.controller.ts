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
import { IngestRequest, MachineIngest } from "../auth/auth";
import { config } from "../common/config";
import { uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { purchaseOrderImport } from "../procurement/procurement.schemas";
import { ProcurementService } from "../procurement/procurement.service";
import { IngestService } from "./ingest.service";
import { ingestBatchInput, ingestCandidatesInput } from "./ingest.schemas";

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
      .object({ name: z.string().min(1).max(160), version: z.string().min(1).max(80) })
      .passthrough(),
  })
  .passthrough();

const toolCall = z
  .object({
    name: z.enum([
      "tome_ingest_get_protocol",
      "tome_ingest_create_batch",
      "tome_ingest_import_order",
      "tome_ingest_upsert_candidates",
      "tome_ingest_get_batch_status",
      "tome_ingest_seal_batch",
    ]),
    arguments: z.record(z.unknown()).default({}),
  })
  .strict();

const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{12,128}$/);

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
  return { code: "INGEST_MCP_TOOL_FAILED", message: "采集工具执行失败" };
}

const toolDefinitions = [
  {
    name: "tome_ingest_get_protocol",
    description: "读取当前服务器协议、Skill 和此来源必须使用的 Profile。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "tome_ingest_create_batch",
    description: "按既有 IngestService 创建可恢复的采集批次。",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        batch: { type: "object" },
      },
      required: ["idempotencyKey", "batch"],
      additionalProperties: false,
    },
  },
  {
    name: "tome_ingest_import_order",
    description: "按既有采购来源合同导入订单原始事实。",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        order: { type: "object" },
      },
      required: ["idempotencyKey", "order"],
      additionalProperties: false,
    },
  },
  {
    name: "tome_ingest_upsert_candidates",
    description: "向开放批次写入候选来源事实；不会创建 TM 或改库存。",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        batchId: { type: "string" },
        candidates: { type: "array" },
      },
      required: ["idempotencyKey", "batchId", "candidates"],
      additionalProperties: false,
    },
  },
  {
    name: "tome_ingest_get_batch_status",
    description: "读取批次状态与完整性报告。",
    inputSchema: {
      type: "object",
      properties: { batchId: { type: "string" } },
      required: ["batchId"],
      additionalProperties: false,
    },
  },
  {
    name: "tome_ingest_seal_batch",
    description: "仅在完整性阻断项清零后封存批次。",
    inputSchema: {
      type: "object",
      properties: {
        idempotencyKey: { type: "string" },
        batchId: { type: "string" },
      },
      required: ["idempotencyKey", "batchId"],
      additionalProperties: false,
    },
  },
] as const;

@ApiTags("Agent 导入 MCP")
@MachineIngest()
@Controller("api/mcp")
export class IngestMcpController {
  constructor(
    private ingest: IngestService,
    private procurement: ProcurementService,
  ) {}

  @Post("ingest")
  @HttpCode(200)
  async handle(
    @Body() raw: unknown,
    @Req() request: IngestRequest,
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

  @Get("ingest")
  @ApiResponse({
    status: 405,
    description: "MCP endpoint does not provide an SSE stream; use POST.",
  })
  streamUnavailable(@Res() responseWriter: Response) {
    responseWriter.status(405).set("Allow", "POST").end();
  }

  private async handleMessage(
    raw: unknown,
    request: IngestRequest,
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
      if (batch)
        return rpcError(id, -32600, "Initialize must not be batched");
      const initialization = initializeInput.safeParse(parsed.data.params);
      if (!initialization.success)
        return rpcError(id, -32602, "Invalid initialize params");
      return response(id, {
        protocolVersion:
          initialization.data.protocolVersion === MCP_PROTOCOL_VERSION
            ? initialization.data.protocolVersion
            : MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "tome-ingest", version: "1.0" },
        instructions:
          "Only use the six ingestion tools. The server API remains the source of truth.",
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
        toolResult(await this.callTool(call.data.name, call.data.arguments, request)),
      );
    } catch (error) {
      return response(id, toolResult(toolFailure(error), true));
    }
  }

  private async callTool(
    name: (typeof toolDefinitions)[number]["name"],
    args: Record<string, unknown>,
    request: IngestRequest,
  ) {
    if (name === "tome_ingest_get_protocol")
      return this.ingest.machineProtocol(request.ingestSession);
    if (name === "tome_ingest_get_batch_status") {
      const input = z.object({ batchId: uuid }).strict().parse(args);
      return this.ingest.machineBatchStatus(request.ingestSession, input.batchId);
    }
    if (name === "tome_ingest_create_batch") {
      const input = z
        .object({ idempotencyKey, batch: z.unknown() })
        .strict()
        .parse(args);
      return this.ingest.createMachineBatch(
        request.ingestSession,
        input.idempotencyKey,
        ingestBatchInput.parse(input.batch),
      );
    }
    if (name === "tome_ingest_import_order") {
      const input = z
        .object({ idempotencyKey, order: z.unknown() })
        .strict()
        .parse(args);
      const order = purchaseOrderImport.parse(input.order);
      if (order.procurementSourceId !== request.ingestSession.procurementSourceId)
        throw new Fault("INGEST_SOURCE_SCOPE", "订单来源不属于当前导入会话", 403);
      return this.ingest.machineRun(
        request.ingestSession,
        "order.import",
        input.idempotencyKey,
        order,
        async (tx) => this.procurement.importInTx(tx, order),
      );
    }
    if (name === "tome_ingest_upsert_candidates") {
      const input = z
        .object({
          idempotencyKey,
          batchId: uuid,
          candidates: z.unknown(),
        })
        .strict()
        .parse(args);
      return this.ingest.upsertMachineCandidates(
        request.ingestSession,
        input.idempotencyKey,
        input.batchId,
        ingestCandidatesInput.parse({ candidates: input.candidates }).candidates,
      );
    }
    const input = z
      .object({ idempotencyKey, batchId: uuid })
      .strict()
      .parse(args);
    return this.ingest.sealMachineBatch(
      request.ingestSession,
      input.idempotencyKey,
      input.batchId,
    );
  }
}
