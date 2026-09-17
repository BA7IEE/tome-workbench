import { Body, Controller, Get, Param, Post, Req, Query } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { Commands, audit } from "../common/transaction";
import { PrismaService } from "../database/prisma.service";
import { amount, currency, safeText, uuid } from "../common/domain";
import { readSales, readInquiries } from "./record-queries";
import { Fault } from "../common/errors";
import { itemLock } from "../catalog/catalog.service";
import { TradingService } from "./trading.service";
@ApiTags("交易与经营账")
@Controller("api")
export class TradingController {
  constructor(
    private service: TradingService,
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Access("sell") @Post("items/:id/reserve") reserve(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.reserve(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("sell") @Post("items/:id/release") release(
    @Param("id") id: string,
    @Req() r: AuthRequest,
  ) {
    return this.service.release(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
    );
  }
  @Access("sell") @Post("items/:id/state") state(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.state(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("finance") @Post("items/:id/intents") intent(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.intent(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("sell") @Post("items/:id/sold") sold(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.sold(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("finance") @Get("sales") sales(@Query() raw: unknown) {
    return readSales(this.db, raw, true);
  }
  @Access("sell") @Get("sale-facts") saleFacts(@Query() raw: unknown) {
    return readSales(this.db, raw, false);
  }
  @Access("finance") @Post("sales/:id/finance") finance(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.finance(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("finance") @Post("sales/:id/refund") refund(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.refund(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @Access("finance") @Post("sales/:id/return") returned(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.returned(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      b,
    );
  }
  @ApiQuery({
    name: "id",
    required: false,
    description: "按询盘编号定位",
    schema: { type: "string", format: "uuid" },
  })
  @ApiQuery({
    name: "itemId",
    required: false,
    description: "按商品编号查看询盘",
    schema: { type: "string", format: "uuid" },
  })
  @Access("sell")
  @Get("inquiries")
  inquiries(@Query() raw: unknown) {
    return readInquiries(this.db, raw);
  }
  @Access("sell") @Get("inquiries/:id/history") async inquiryHistory(
    @Param("id") id: string,
  ) {
    const row = await this.db.inquiry.findFirst({
      where: {
        id: uuid.parse(id),
        item: { deletedAt: null, dataMode: "BUSINESS" },
      },
    });
    if (!row) throw new Fault("NOT_FOUND", "询盘不存在", 404);
    const history = await this.db.audit.findMany({
      where: {
        resourceId: row.itemId,
        action: "INQUIRY_UPDATED",
        detail: { path: ["inquiryId"], equals: id },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    history.sort(
      (a, b) =>
        Number((a.detail as { version?: number }).version || 0) -
        Number((b.detail as { version?: number }).version || 0),
    );
    return {
      initial: history.length
        ? (history[0].detail as { previousNotes?: string }).previousNotes || ""
        : row.notes,
      rows: history.map((x) => ({ at: x.createdAt, detail: x.detail })),
    };
  }
  @Access("sell") @Post("inquiries") inquiry(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        itemId: uuid,
        channel: safeText(120).optional(),
        channelId: uuid.optional(),
        customerRef: safeText(200).min(1),
        notes: safeText(4000).default(""),
        quote: amount.default(null),
        currency: currency.default("CNY"),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (!value.channel && !value.channelId)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["channel"],
            message: "请填写实际询盘渠道或选择已配置账号",
          });
      })
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "inquiry.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        await itemLock(tx, b.itemId);
        let channelName = b.channel || "";
        if (b.channelId) {
          const configured = await tx.channel.findUnique({
            where: { id: b.channelId },
          });
          if (!configured)
            throw new Fault("CHANNEL_NOT_FOUND", "所选渠道账号不存在", 400);
          channelName = configured.name;
        }
        const i = await tx.inquiry.create({
          data: { ...b, channel: channelName, channelId: b.channelId || null },
        });
        await audit(tx, r.actor.id, "INQUIRY_CREATED", b.itemId, {
          inquiryId: i.id,
        });
        return { id: i.id };
      },
    );
  }
  @Access("sell") @Post("inquiries/:id/status") inquiryStatus(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        version: z.number().int().positive(),
        state: z.enum(["OPEN", "FOLLOWUP", "LOST"]),
        notes: safeText(4000),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "inquiry.status",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const found = await tx.inquiry.findUniqueOrThrow({ where: { id } });
        await itemLock(tx, found.itemId);
        const current = await tx.inquiry.findUniqueOrThrow({ where: { id } });
        if (current.version !== b.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "这条询盘刚被更新。你的输入已保留，请查看最新沟通记录后重新确认。",
            409,
          );
        if (current.state === "WON")
          throw new Fault(
            "INQUIRY_CONVERTED_IMMUTABLE",
            "已转化成交的询盘必须保留对应 Sale，不能再通过普通状态修改",
            409,
          );
        const i = await tx.inquiry.update({
          where: { id },
          data: {
            state: b.state,
            notes: b.notes || current.notes,
            version: { increment: 1 },
          },
        });
        await audit(tx, r.actor.id, "INQUIRY_UPDATED", i.itemId, {
          actorName: r.actor.name,
          inquiryId: id,
          version: i.version,
          previousNotes: current.notes,
          previousState: current.state,
          state: b.state,
          notes: b.notes,
        });
        return { id, version: i.version };
      },
    );
  }
  @Access("sell") @Post("inquiries/:id/convert") convertInquiry(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.convertInquiry(
      r.actor,
      uuid.parse(id),
      r.get("Idempotency-Key"),
      raw,
    );
  }
  @Access("users") @Post("observations/:id/resolve") resolve(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({ reason: safeText(2000).min(1) })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "observation.resolve",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const o = await tx.observation.findUniqueOrThrow({ where: { id } });
        await itemLock(tx, o.itemId);
        await tx.observation.update({
          where: { id },
          data: { resolved: true },
        });
        await audit(tx, r.actor.id, "OBSERVATION_RESOLVED", o.itemId, {
          observationId: id,
          reason: b.reason,
        });
        return { id };
      },
    );
  }
}
