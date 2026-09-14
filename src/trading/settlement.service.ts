// Internal accounting snapshots only. No payment provider, network call or money transfer.
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { Actor } from "../auth/auth";
import { Commands, Tx, audit, hash, json } from "../common/transaction";
import { contribution, currency, uuid } from "../common/domain";
import { Fault } from "../common/errors";
export function shareMinor(profit: number, basisPoints: number) {
  if (
    !Number.isSafeInteger(profit) ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  )
    throw new Error("Invalid settlement arithmetic");
  const n = BigInt(profit) * BigInt(basisPoints),
    negative = n < 0n;
  const rounded = ((negative ? -n : n) + 5000n) / 10000n;
  const value = Number(negative ? -rounded : rounded);
  if (!Number.isSafeInteger(value))
    throw new Error("Settlement amount overflow");
  return value;
}
export const periodSchema = z
  .object({
    ruleId: uuid,
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    currency,
    baseId: uuid.optional(),
  })
  .strict();
type Period = z.infer<typeof periodSchema>;
type Summary = {
  profit: number;
  partnerShare: number;
  operatorShare: number;
  included: number;
  excluded: number;
  pending: number;
};
@Injectable()
export class SettlementService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  async calculate(tx: Tx, b: Period) {
    const start = new Date(b.periodStart),
      end = new Date(b.periodEnd);
    if (start >= end || end.getTime() - start.getTime() > 370 * 86400000)
      throw new Fault("INVALID_PERIOD", "区间须为左闭右开且不超过370天", 400);
    const rule = await tx.settlementRule.findUniqueOrThrow({
      where: { id: b.ruleId },
    });
    if (rule.status !== "ACTIVE")
      throw new Fault("RULE_NOT_ACTIVE", "须先由管理员明确启用双方确认的规则");
    if (rule.effectiveFrom > start || rule.effectiveTo < end)
      throw new Fault("RULE_PERIOD", "对账区间超出该规则适用期");
    const rows = await tx.sale.findMany({
      where: {
        soldAt: { gte: start, lt: end },
        currency: b.currency,
        item: { dataMode: "BUSINESS" },
      },
      orderBy: { id: "asc" },
      take: 50001,
    });
    if (rows.length > 50000)
      throw new Fault("PERIOD_TOO_LARGE", "请拆分对账区间，禁止截断统计");
    const lines = rows.map((s) => ({
      saleId: s.id,
      itemId: s.itemId,
      version: s.version,
      soldAt: s.soldAt.toISOString(),
      amount: s.amount,
      cost: s.cost,
      fees: s.fees,
      refunded: s.refunded,
      returned: s.returned,
      paid: s.paid,
      cooperation: s.cooperation,
      contribution: contribution(s),
    }));
    const conflicts = await tx.observation.findMany({
      where: { itemId: { in: rows.map((r) => r.itemId) }, resolved: false },
      orderBy: { id: "asc" },
      select: { id: true, itemId: true, kind: true },
    });
    const orphans = await tx.item.findMany({
      where: {
        dataMode: "BUSINESS",
        status: "SOLD",
        sales: { none: { returned: false } },
      },
      orderBy: { id: "asc" },
      select: { id: true, serial: true },
      take: 100,
    });
    const summary: Summary = {
      profit: 0,
      partnerShare: 0,
      operatorShare: 0,
      included: 0,
      excluded: 0,
      pending: 0,
    };
    for (const l of lines) {
      if (l.contribution.state === "EXCLUDED") summary.excluded++;
      else if (l.contribution.state === "PENDING") summary.pending++;
      else {
        summary.included++;
        summary.profit += l.contribution.value!;
      }
    }
    if (!Number.isSafeInteger(summary.profit))
      throw new Fault("AMOUNT_OVERFLOW", "统计金额超出安全范围");
    summary.partnerShare = shareMinor(summary.profit, rule.basisPoints);
    summary.operatorShare = summary.profit - summary.partnerShare;
    const base = b.baseId
      ? await tx.settlementStatement.findUnique({ where: { id: b.baseId } })
      : null;
    if (
      b.baseId &&
      (!base ||
        base.status !== "CONFIRMED" ||
        base.ruleId !== b.ruleId ||
        base.currency !== b.currency ||
        base.periodStart.getTime() !== start.getTime() ||
        base.periodEnd.getTime() !== end.getTime())
    )
      throw new Fault(
        "BASE_MISMATCH",
        "更正必须关联同规则、同币种、同期间的已确认快照",
      );
    const previous = base
      ? (base.snapshot as unknown as { summary: Summary }).summary
      : null;
    const delta = {
      profit: summary.profit - (previous?.profit || 0),
      partnerShare: summary.partnerShare - (previous?.partnerShare || 0),
      operatorShare: summary.operatorShare - (previous?.operatorShare || 0),
    };
    const issues = [
      ...(summary.pending ? ["INCOMPLETE_SALES"] : []),
      ...(conflicts.length ? ["UNRESOLVED_CONFLICTS"] : []),
      ...(orphans.length ? ["SOLD_WITHOUT_SALE"] : []),
    ];
    const basis = {
      rule: {
        id: rule.id,
        name: rule.name,
        agreementRef: rule.agreementRef,
        basisPoints: rule.basisPoints,
      },
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      currency: b.currency,
      baseId: b.baseId || null,
      lines,
      conflicts,
      orphans,
      summary,
      delta,
      issues,
    };
    return { ...basis, digest: hash(basis) };
  }
  preview(actor: Actor, key: unknown, raw: unknown) {
    const b = periodSchema.parse(raw);
    return this.commands.run(
      actor.id,
      "settlement.preview",
      key,
      b,
      async (tx) => {
        const result = await this.calculate(tx, b);
        const row = await tx.settlementStatement.create({
          data: {
            ruleId: b.ruleId,
            periodStart: new Date(b.periodStart),
            periodEnd: new Date(b.periodEnd),
            currency: b.currency,
            baseId: b.baseId || null,
            digest: result.digest,
            snapshot: json(result),
            createdBy: actor.id,
          },
        });
        for (const line of result.lines)
          await tx.settlementLine.create({
            data: {
              statementId: row.id,
              saleId: line.saleId,
              snapshot: json(line),
            },
          });
        await audit(tx, actor.id, "SETTLEMENT_PREVIEW_CREATED", row.id, {
          digest: result.digest,
        });
        return { id: row.id, digest: result.digest };
      },
    );
  }
  confirm(actor: Actor, id: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      actor.id,
      "settlement.confirm",
      key,
      { id: uuid.parse(id), ...b },
      async (tx) => {
        const row = await tx.settlementStatement.findUniqueOrThrow({
          where: { id },
        });
        if (row.digest !== b.digest)
          throw new Fault("PREVIEW_MISMATCH", "确认的不是当前这份预览");
        if (row.status === "CONFIRMED") return { id, existing: true };
        const current = await this.calculate(tx, {
          ruleId: row.ruleId,
          periodStart: row.periodStart.toISOString(),
          periodEnd: row.periodEnd.toISOString(),
          currency: currency.parse(row.currency),
          ...(row.baseId ? { baseId: row.baseId } : {}),
        });
        if (current.digest !== row.digest)
          throw new Fault(
            "STALE_PREVIEW",
            "收支、例外或冲突已变化，请重新生成预览",
          );
        if (current.issues.length)
          throw new Fault("UNRESOLVED_SETTLEMENT", current.issues.join("；"));
        const overlaps = await tx.settlementStatement.findMany({
          where: {
            status: "CONFIRMED",
            currency: row.currency,
            periodStart: { lt: row.periodEnd },
            periodEnd: { gt: row.periodStart },
          },
          orderBy: { confirmedAt: "desc" },
        });
        if (
          overlaps.some(
            (p) =>
              p.periodStart.getTime() !== row.periodStart.getTime() ||
              p.periodEnd.getTime() !== row.periodEnd.getTime(),
          )
        )
          throw new Fault(
            "PERIOD_OVERLAP",
            "存在重叠的已确认期间，不能重复计提",
          );
        if ((overlaps[0]?.id || null) !== row.baseId)
          throw new Fault(
            "CORRECTION_REQUIRED",
            "此期间已确认或已有更新更正，必须以最新已确认版本为更正基础",
          );
        await tx.settlementStatement.update({
          where: { id },
          data: {
            status: "CONFIRMED",
            confirmedBy: actor.id,
            confirmedAt: new Date(),
          },
        });
        await audit(tx, actor.id, "SETTLEMENT_CONFIRMED", id, {
          digest: row.digest,
          baseId: row.baseId,
          currency: row.currency,
        });
        return { id, confirmed: true, payoutExecuted: false };
      },
    );
  }
  list() {
    return this.db.settlementStatement.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { rule: { select: { name: true } } },
    });
  }
}
