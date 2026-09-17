import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import {
  Commands,
  audit,
  event,
  json,
  lock,
  type Tx,
} from "../common/transaction";
import type { Actor } from "../auth/auth";
import { Fault } from "../common/errors";
import {
  allocateEqual,
  allocateProportional,
  convertByFx,
  deriveFxMicros,
  economicForeignTotal,
  creditValue,
  netPayment,
} from "./costing.logic";
import type { z } from "zod";
import {
  orderCostBasisInput,
  paymentBreakdownInput,
  sourceCostPolicyInput,
} from "./costing.schemas";

type SourcePolicy = z.infer<typeof sourceCostPolicyInput>;
type BasisInput = z.infer<typeof orderCostBasisInput>;

@Injectable()
export class CostingService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  setSourcePolicy(actor: Actor, key: unknown, id: string, b: SourcePolicy) {
    return this.commands.run(
      actor.id,
      "costing.source.policy",
      key,
      { id, ...b },
      async (tx) => {
        await lock(tx, "procurement-source:" + id);
        const s = await tx.procurementSource.findUniqueOrThrow({
          where: { id },
        });
        if (s.version !== b.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "采购来源规则已被修改，请重新读取",
            409,
          );
        const row = await tx.procurementSource.update({
          where: { id },
          data: {
            orderOverheadCny: b.orderOverheadCny,
            costAllocationMethod: b.costAllocationMethod,
            storeCreditAsPayment: b.storeCreditAsPayment,
            version: { increment: 1 },
          },
        });
        await audit(tx, actor.id, "SOURCE_COST_POLICY_UPDATED", id, {
          before: {
            orderOverheadCny: s.orderOverheadCny,
            method: s.costAllocationMethod,
            storeCreditAsPayment: s.storeCreditAsPayment,
          },
          after: {
            orderOverheadCny: row.orderOverheadCny,
            method: row.costAllocationMethod,
            storeCreditAsPayment: row.storeCreditAsPayment,
          },
          note: b.note,
        });
        return { id, version: row.version };
      },
    );
  }
  setOrderBasis(actor: Actor, key: unknown, orderId: string, b: BasisInput) {
    return this.commands.run(
      actor.id,
      "costing.order.basis",
      key,
      { orderId, ...b },
      async (tx) => {
        await lock(tx, "financial-journal");
        await lock(tx, "purchase-order:" + orderId);
        const order = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: orderId },
          include: { procurementSource: true, costBasis: true },
        });
        const current = order.costBasis;
        if ((current?.version ?? 0) !== b.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "订单成本依据已变化，请重新读取",
            409,
          );
        if (b.mode === "ACTUAL_CASH_CNY" && b.cashPaidCny === null)
          throw new Fault(
            "CASH_CNY_REQUIRED",
            "实际扣款模式必须填写实际人民币扣款",
            400,
          );
        if (b.mode !== "ACTUAL_CASH_CNY" && b.fxMicros === null)
          throw new Fault("FX_REQUIRED", "汇率模式必须填写确认汇率", 400);
        let foreignTotal = b.foreignEconomicTotalOverride;
        if (b.paymentBreakdown) {
          if (!order.procurementSource.storeCreditAsPayment)
            throw new Fault(
              "CREDIT_POLICY_REQUIRED",
              "支付退款明细按Credit等同现金计算，请先启用来源的Credit支付规则",
              400,
            );
          try {
            const net = netPayment(b.paymentBreakdown);
            const refunds = b.paymentBreakdown.lineRefunds || [];
            if (refunds.length) {
              if (new Set(refunds.map((r) => r.lineId)).size !== refunds.length)
                throw new Error("同一件商品的退款归属不能重复");
              if (
                refunds.reduce((n, r) => n + r.amount, 0) !==
                b.paymentBreakdown.cashRefunded +
                  b.paymentBreakdown.creditRefunded
              )
                throw new Error("逐件退款合计必须等于现金与Credit退款总额");
              const count = await tx.purchaseLine.count({
                where: { orderId, id: { in: refunds.map((r) => r.lineId) } },
              });
              if (count !== refunds.length)
                throw new Error("退款归属包含其他订单的商品");
            }
            if (foreignTotal !== null && foreignTotal !== net)
              throw new Error(
                "最终经济支付与支付退款明细不一致，请勿重复扣减退款",
              );
            foreignTotal = net;
          } catch (error) {
            throw new Fault(
              "INVALID_PAYMENT_BREAKDOWN",
              (error as Error).message,
              400,
            );
          }
        }
        // Persist the rate at confirmation. Later source payment updates must
        // never re-derive a historical rate from a refunded/net payment amount.
        let fxMicros = b.fxMicros;
        if (order.currency === "CNY") fxMicros = 1000000;
        else if (b.mode === "ACTUAL_CASH_CNY" && fxMicros === null) {
          const sameCashBasis =
            current?.mode === b.mode && current.cashPaidCny === b.cashPaidCny;
          const paid = b.paymentBreakdown?.cashPaid ?? order.paymentAmount;
          fxMicros =
            sameCashBasis && current.fxMicros !== null
              ? current.fxMicros
              : paid !== null && paid > 0
                ? deriveFxMicros(b.cashPaidCny!, paid)
                : null;
        }
        if (fxMicros === null || fxMicros < 1 || fxMicros > 100000000)
          throw new Fault(
            "FX_REQUIRED",
            "无法确认原采购汇率；请填写与原始现金支付对应的人民币扣款或确认汇率",
            400,
          );
        const version = (current?.version ?? 0) + 1,
          values = {
            version,
            mode: b.mode,
            cashPaidCny: b.cashPaidCny,
            fxMicros,
            foreignEconomicTotalOverride: foreignTotal,
            overheadCny: b.overheadCny,
            note: b.note,
            updatedBy: actor.id,
          };
        const row = current
          ? await tx.purchaseOrderCostBasis.update({
              where: { orderId },
              data: values,
            })
          : await tx.purchaseOrderCostBasis.create({
              data: { orderId, ...values },
            });
        await tx.purchaseOrderCostBasisRevision.create({
          data: {
            orderId,
            version,
            snapshot: json({
              mode: row.mode,
              cashPaidCny: row.cashPaidCny,
              fxMicros: row.fxMicros,
              foreignEconomicTotalOverride: row.foreignEconomicTotalOverride,
              overheadCny: row.overheadCny,
              note: row.note,
              paymentBreakdown: b.paymentBreakdown,
              orderVersion: order.version,
              sourcePolicyVersion: order.procurementSource.version,
            }),
          },
        });
        await audit(tx, actor.id, "ORDER_COST_BASIS_CONFIRMED", orderId, {
          version,
          mode: row.mode,
          overheadCny: row.overheadCny,
          note: row.note,
        });
        return { orderId, version };
      },
    );
  }
  private async calculate(tx: Tx, orderId: string) {
    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        procurementSource: true,
        costBasis: {
          include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        },
        adjustments: true,
        returns: true,
        lines: {
          orderBy: { createdAt: "asc" },
          include: {
            itemLink: {
              include: {
                item: {
                  select: { id: true, serial: true, title: true, cycle: true },
                },
              },
            },
          },
        },
      },
    });
    const blockers: string[] = [],
      warnings: string[] = [];
    const pending = order.lines.filter(
      (l) =>
        l.businessDecision === "UNDECIDED" ||
        (l.businessDecision === "INCLUDE" && !l.itemLink),
    );
    if (pending.length)
      blockers.push(`${pending.length}件订单行尚未完成保留/排除确认`);
    const retained = order.lines
      .filter((l) => l.businessDecision === "INCLUDE" && l.itemLink)
      .map((l) => ({ ...l, itemLink: l.itemLink! }));
    if (!retained.length) blockers.push("当前没有已确认保留并关联TM的商品");
    if (retained.some((l) => !l.lineAmount || l.lineAmount <= 0))
      blockers.push("部分保留商品缺少有效订单原价，无法按比例分摊");
    const excluded = order.lines.filter(
      (l) => l.businessDecision === "EXCLUDE",
    );
    const basis = order.costBasis;
    if (!basis) blockers.push("尚未确认订单汇率/人民币扣款和附加成本");
    const refundSignal = order.adjustments.some(
      (a) =>
        a.kind === "REFUND" ||
        (a.kind === "STORE_CREDIT" && a.amount > 0) ||
        /refund|退款|退回.*(?:credit|抵用)/i.test(a.label),
    );
    const needsOverride =
      order.returns.length > 0 || excluded.length > 0 || refundSignal;
    if (needsOverride && basis?.foreignEconomicTotalOverride == null)
      blockers.push(
        "订单存在现金/Credit退款、退货/RMA或排除商品，请先人工确认本单最终经济支付金额",
      );
    if (
      order.adjustments.some((a) => a.currency !== order.currency) ||
      retained.some((l) => l.currency !== order.currency)
    )
      blockers.push(
        "订单金额存在不同币种，不能直接合计或分摊，请先核对来源金额",
      );
    const latestSnapshot = basis?.revisions[0]?.snapshot;
    const paymentBreakdown =
      latestSnapshot &&
      typeof latestSnapshot === "object" &&
      !Array.isArray(latestSnapshot)
        ? paymentBreakdownInput.safeParse(latestSnapshot.paymentBreakdown)
        : null;
    if (
      latestSnapshot &&
      typeof latestSnapshot === "object" &&
      !Array.isArray(latestSnapshot) &&
      ((typeof latestSnapshot.orderVersion === "number" &&
        latestSnapshot.orderVersion !== order.version) ||
        (typeof latestSnapshot.sourcePolicyVersion === "number" &&
          latestSnapshot.sourcePolicyVersion !==
            order.procurementSource.version))
    )
      blockers.push(
        "采购来源或成本规则在确认后发生变化，请重新确认成本依据，避免沿用旧退款净额",
      );
    if (
      order.procurementSource.costAllocationMethod !==
      "PROPORTIONAL_LINE_AMOUNT"
    )
      blockers.push("当前来源成本分摊规则不受支持");
    let foreignTotal: number | null = null,
      effectiveFxMicros: number | null = null,
      economicCny: number | null = null;
    if (basis) {
      try {
        const credits = order.adjustments
          .filter((a) => a.kind === "STORE_CREDIT")
          .map((a) => a.amount);
        foreignTotal = economicForeignTotal({
          paymentAmount: order.paymentAmount,
          totalAmount: order.totalAmount,
          storeCreditAsPayment: order.procurementSource.storeCreditAsPayment,
          storeCredits: credits,
          override: basis.foreignEconomicTotalOverride,
        });
        if (order.currency === "CNY") {
          effectiveFxMicros = 1000000;
          economicCny = foreignTotal;
        } else if (basis.mode === "ACTUAL_CASH_CNY") {
          if (basis.cashPaidCny === null) throw new Error("缺少实际人民币扣款");
          effectiveFxMicros = basis.fxMicros;
          if (effectiveFxMicros === null)
            throw new Error(
              "旧成本依据尚未固定原采购汇率，请重新确认成本依据后再计算",
            );
          economicCny =
            basis.foreignEconomicTotalOverride !== null
              ? convertByFx(foreignTotal, effectiveFxMicros)
              : basis.cashPaidCny +
                convertByFx(
                  creditValue(
                    credits,
                    order.procurementSource.storeCreditAsPayment,
                  ),
                  effectiveFxMicros,
                );
        } else {
          if (basis.fxMicros === null) throw new Error("缺少确认汇率");
          effectiveFxMicros = basis.fxMicros;
          economicCny = convertByFx(foreignTotal, effectiveFxMicros);
        }
      } catch (error) {
        blockers.push((error as Error).message);
      }
    }
    const rows: {
      lineId: string;
      itemId: string;
      code: string;
      title: string;
      lineAmount: number;
      purchaseCny: number;
      overheadCny: number;
      totalCny: number;
    }[] = [];
    const itemRefunds = paymentBreakdown?.success
      ? paymentBreakdown.data.lineRefunds || []
      : [];
    if (itemRefunds.some((r) => !retained.some((l) => l.id === r.lineId)))
      blockers.push(
        "逐件退款包含未保留或未关联TM的商品，请核对退回实物及最终分摊，不能转嫁退款到其他商品",
      );
    if (
      !blockers.length &&
      basis &&
      economicCny !== null &&
      effectiveFxMicros !== null
    ) {
      const refundCny = itemRefunds.length
        ? convertByFx(
            itemRefunds.reduce((n, r) => n + r.amount, 0),
            effectiveFxMicros,
          )
        : 0;
      const purchase = allocateProportional(
        economicCny + refundCny,
        retained.map((l) => ({ id: l.id, weight: l.lineAmount! })),
      );
      if (itemRefunds.length) {
        const refunds = allocateProportional(
          refundCny,
          itemRefunds.map((r) => ({ id: r.lineId, weight: r.amount })),
        );
        for (const [lineId, amount] of refunds) {
          const net = purchase.get(lineId)! - amount;
          if (net < 0)
            blockers.push(
              "本件退款超过按比例分摊的采购款，请核对该件优惠与实际成本；系统不会生成负采购成本",
            );
          purchase.set(lineId, net);
        }
      }
      const overhead = allocateEqual(
        basis.overheadCny,
        retained.map((l) => l.id),
      );
      for (const l of blockers.length ? [] : retained)
        rows.push({
          lineId: l.id,
          itemId: l.itemLink.item.id,
          code: `TM${String(l.itemLink.item.serial).padStart(6, "0")}`,
          title: l.itemLink.item.title,
          lineAmount: l.lineAmount!,
          purchaseCny: purchase.get(l.id)!,
          overheadCny: overhead.get(l.id)!,
          totalCny: purchase.get(l.id)! + overhead.get(l.id)!,
        });
    }
    if (order.returns.length)
      warnings.push(
        `来源订单记录到${order.returns.length}条退货/RMA，已要求人工确认最终经济支付金额`,
      );
    if (excluded.length)
      warnings.push(`${excluded.length}件商品已排除，不参与当前成本分摊`);
    return {
      ready: !blockers.length,
      blockers,
      warnings,
      order: {
        id: order.id,
        externalOrderNo: order.externalOrderNo,
        currency: order.currency,
        paymentAmount: order.paymentAmount,
        totalAmount: order.totalAmount,
        orderedAt: order.orderedAt,
      },
      source: {
        id: order.procurementSource.id,
        name: order.procurementSource.name,
        orderOverheadCny: order.procurementSource.orderOverheadCny,
        storeCreditAsPayment: order.procurementSource.storeCreditAsPayment,
      },
      basis,
      paymentBreakdown: paymentBreakdown?.success
        ? paymentBreakdown.data
        : null,
      foreignEconomicTotal: foreignTotal,
      effectiveFxMicros,
      economicCny,
      overheadCny: basis?.overheadCny ?? null,
      totalCny:
        economicCny === null || !basis ? null : economicCny + basis.overheadCny,
      rows,
    };
  }

  preview(orderId: string) {
    return this.db.$transaction((tx) => this.calculate(tx, orderId));
  }
  previews(orderIds: string[]) {
    return this.db.$transaction(async (tx) => {
      // Keep the exact per-order calculator as the only cost algorithm. The
      // batch endpoint only shares one read transaction and one HTTP request.
      const rows = await Promise.all(
        orderIds.map(async (orderId) => ({
          orderId,
          preview: await this.calculate(tx, orderId),
        })),
      );
      return { rows };
    });
  }
  commit(actor: Actor, key: unknown, orderId: string, basisVersion: number) {
    return this.commands.run(
      actor.id,
      "costing.order.commit",
      key,
      { orderId, basisVersion },
      async (tx) => {
        await lock(tx, "financial-journal");
        await lock(tx, "purchase-order:" + orderId);
        const calc = await this.calculate(tx, orderId);
        if (!calc.ready)
          throw new Fault(
            "COST_ALLOCATION_NOT_READY",
            calc.blockers.join("；"),
            400,
          );
        if (!calc.basis || calc.basis.version !== basisVersion)
          throw new Fault(
            "VERSION_CONFLICT",
            "订单成本依据已变化，请重新预览",
            409,
          );
        const results = [] as {
          itemId: string;
          costEntryId: string;
          amount: number;
          existing: boolean;
        }[];
        for (const row of calc.rows) {
          await lock(tx, "item:" + row.itemId);
          const item = await tx.item.findUniqueOrThrow({
              where: { id: row.itemId },
            }),
            sourceRef = `${orderId}:${row.lineId}`;
          const active = await tx.costEntry.findFirst({
            where: {
              itemId: row.itemId,
              sourceType: "PROCUREMENT_ORDER",
              sourceRef,
              status: "ACTIVE",
            },
            orderBy: { createdAt: "desc" },
          });
          if (
            active?.amount === row.totalCny &&
            active.currency === "CNY" &&
            active.confirmed
          ) {
            results.push({
              itemId: row.itemId,
              costEntryId: active.id,
              amount: active.amount,
              existing: true,
            });
            continue;
          }
          if (active)
            await tx.costEntry.update({
              where: { id: active.id },
              data: { status: "VOID" },
            });
          const note = `采购订单 ${calc.order.externalOrderNo} 自动成本：采购分摊 ¥${(row.purchaseCny / 100).toFixed(2)} + 每单附加成本分摊 ¥${(row.overheadCny / 100).toFixed(2)}；依据版本 ${basisVersion}`;
          const cost = await tx.costEntry.create({
            data: {
              itemId: row.itemId,
              cycleNumber: item.cycle,
              kind: "PURCHASE",
              amount: row.totalCny,
              currency: "CNY",
              confirmed: true,
              status: "ACTIVE",
              sourceType: "PROCUREMENT_ORDER",
              sourceRef,
              note,
              createdBy: actor.id,
              occurredAt: calc.order.orderedAt ?? new Date(),
            },
          });
          await audit(tx, actor.id, "PROCUREMENT_COST_APPLIED", row.itemId, {
            orderId,
            lineId: row.lineId,
            costEntryId: cost.id,
            purchaseCny: row.purchaseCny,
            overheadCny: row.overheadCny,
            totalCny: row.totalCny,
            basisVersion,
          });
          await event(tx, row.itemId, "PROCUREMENT_COST_APPLIED", {
            orderId,
            costEntryId: cost.id,
            basisVersion,
          });
          results.push({
            itemId: row.itemId,
            costEntryId: cost.id,
            amount: cost.amount,
            existing: false,
          });
        }
        await audit(tx, actor.id, "ORDER_COST_ALLOCATION_COMMITTED", orderId, {
          basisVersion,
          count: results.length,
          totalCny: calc.totalCny,
        });
        return {
          orderId,
          basisVersion,
          totalCny: calc.totalCny,
          rows: results,
        };
      },
    );
  }
}
