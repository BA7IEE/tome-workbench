import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { Commands, audit, lock } from "../common/transaction";
import { uuid, safeText, currency, expectedVersion } from "../common/domain";
import { PrismaService } from "../database/prisma.service";
import { itemLock, versionMatch } from "../catalog/catalog.service";
@ApiTags("成本明细与人工归属核对")
@Access("finance")
@Controller("api")
export class CostsController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Get("items/:id/costs") list(@Param("id") id: string) {
    return this.db.costEntry.findMany({
      where: { itemId: uuid.parse(id) },
      orderBy: { createdAt: "desc" },
    });
  }
  @Post("items/:id/costs") add(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        kind: z.enum([
          "PURCHASE",
          "INBOUND_SHIPPING",
          "AUTHENTICATION",
          "PREPARATION",
          "OTHER",
        ]),
        amount: z.number().int().min(0).max(2000000000),
        currency,
        confirmed: z.boolean(),
        note: safeText(4000).min(1),
        occurredAt: z.string().datetime(),
      })
      .strict()
      .parse(raw);
    uuid.parse(id);
    return this.commands.run(
      r.actor.id,
      "cost.add",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        const i = await itemLock(tx, id);
        const row = await tx.costEntry.create({
          data: {
            ...b,
            itemId: id,
            cycleNumber: i.cycle,
            occurredAt: new Date(b.occurredAt),
            createdBy: r.actor.id,
          },
        });
        await audit(tx, r.actor.id, "COST_RECORDED", id, {
          costId: row.id,
          confirmed: b.confirmed,
        });
        return { id: row.id };
      },
    );
  }
  @Post("costs/:id/void") async voidCost(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({ reason: safeText(4000).min(1) })
      .strict()
      .parse(raw);
    const row = await this.db.costEntry.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
    return this.commands.run(
      r.actor.id,
      "cost.void",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await itemLock(tx, row.itemId);
        await tx.costEntry.update({ where: { id }, data: { status: "VOID" } });
        await audit(tx, r.actor.id, "COST_VOIDED", row.itemId, {
          costId: id,
          reason: b.reason,
        });
        return { id };
      },
    );
  }
  @Access("users") @Post("sales/:id/classify") classify(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        version: expectedVersion,
        cooperation: z.enum(["INCLUDED", "EXCLUDED"]),
        reason: safeText(4000).min(1),
        ruleReference: safeText(1000).min(1),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(raw);
    uuid.parse(id);
    return this.commands.run(
      r.actor.id,
      "sale.classify",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        const s = await tx.sale.findUniqueOrThrow({ where: { id } });
        await itemLock(tx, s.itemId);
        await lock(tx, "sale:" + id);
        const current = await tx.sale.findUniqueOrThrow({ where: { id } });
        versionMatch(current.version, b.version);
        await tx.sale.update({
          where: { id },
          data: { cooperation: b.cooperation, version: { increment: 1 } },
        });
        await audit(tx, r.actor.id, "SALE_COOPERATION_REVIEWED", s.itemId, {
          saleId: id,
          previous: current.cooperation,
          next: b.cooperation,
          reason: b.reason,
          ruleReference: b.ruleReference,
        });
        return { id };
      },
    );
  }
}
