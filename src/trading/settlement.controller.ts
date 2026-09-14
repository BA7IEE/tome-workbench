import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit } from "../common/transaction";
import { safeText, uuid, tm } from "../common/domain";
import { Fault } from "../common/errors";
import { SettlementService } from "./settlement.service";
@Controller("api/settlements")
@Access("finance")
export class SettlementController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private service: SettlementService,
  ) {}
  @Get("rules") rules() {
    return this.db.settlementRule.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
  @Access("users") @Post("rules") createRule(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        name: safeText(150).min(1),
        agreementRef: safeText(500).min(3),
        basisPoints: z.number().int().min(0).max(10000),
        effectiveFrom: z.string().datetime(),
        effectiveTo: z.string().datetime(),
      })
      .strict()
      .parse(raw);
    if (new Date(b.effectiveFrom) >= new Date(b.effectiveTo))
      throw new Fault("INVALID_TERM", "适用期不正确", 400);
    return this.commands.run(
      r.actor.id,
      "settlement.rule.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        const row = await tx.settlementRule.create({
          data: {
            ...b,
            effectiveFrom: new Date(b.effectiveFrom),
            effectiveTo: new Date(b.effectiveTo),
            createdBy: r.actor.id,
          },
        });
        await audit(tx, r.actor.id, "SETTLEMENT_RULE_DRAFTED", row.id);
        return { id: row.id };
      },
    );
  }
  @Access("users") @Post("rules/:id/activate") activate(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        confirmed: z.literal(true),
        agreementRef: safeText(500).min(3),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "settlement.rule.activate",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const rule = await tx.settlementRule.findUniqueOrThrow({
          where: { id },
        });
        if (rule.agreementRef !== b.agreementRef)
          throw new Fault("AGREEMENT_REF_MISMATCH", "规则依据不匹配");
        if (rule.status === "ACTIVE") return { id, existing: true };
        await tx.settlementRule.update({
          where: { id },
          data: {
            status: "ACTIVE",
            activatedBy: r.actor.id,
            activatedAt: new Date(),
          },
        });
        await audit(tx, r.actor.id, "SETTLEMENT_RULE_ACTIVATED", id, {
          agreementRef: b.agreementRef,
        });
        return { id };
      },
    );
  }
  @Get() list() {
    return this.service.list();
  }
  @Get(":id") async detail(@Param("id") id: string) {
    const row = await this.db.settlementStatement.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
      include: { rule: true },
    });
    const isolatedLines = await this.db.settlementLine.count({
      where: { statementId: id, sale: { item: { dataMode: "TEST" } } },
    });
    const links = await this.db.settlementLine.findMany({
      where: { statementId: id },
      include: {
        sale: {
          include: {
            item: { select: { serial: true, title: true, dataMode: true } },
          },
        },
      },
    });
    return {
      ...row,
      isolatedTestLines: isolatedLines,
      lineReferences: links.map((l) => ({
        saleId: l.saleId,
        code: tm(l.sale.item.serial),
        title: l.sale.item.title,
        dataMode: l.sale.item.dataMode,
      })),
    };
  }
  @Post("preview") preview(@Body() raw: unknown, @Req() r: AuthRequest) {
    return this.service.preview(r.actor, r.get("Idempotency-Key"), raw);
  }
  @Post(":id/confirm") confirm(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    return this.service.confirm(r.actor, id, r.get("Idempotency-Key"), raw);
  }
}
