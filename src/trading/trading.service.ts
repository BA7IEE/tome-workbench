import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { Actor, permission } from "../auth/auth";
import { Commands, Tx, audit, event, json } from "../common/transaction";
import { Fault } from "../common/errors";
import { amount, currency, expectedVersion, safeText } from "../common/domain";
import { itemLock, versionMatch } from "../catalog/catalog.service";
import { planStopDistribution } from "../distribution/distribution.service";
async function stop(
  tx: Tx,
  itemId: string,
  status: string,
  actor: string,
  reason: string,
) {
  const before = await tx.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { status: true, cycle: true },
  });
  await tx.item.update({ where: { id: itemId }, data: { status } });
  await tx.listing.updateMany({
    where: { itemId, desired: "LIVE" },
    data: { desired: "OFFLINE" },
  });
  const delistAttemptIds =
    before.status === "AVAILABLE" && status !== "AVAILABLE"
      ? await planStopDistribution(
          tx,
          actor,
          itemId,
          before.cycle,
          `ITEM_BECAME_${status}`,
        )
      : [];
  await audit(tx, actor, "INVENTORY_" + status, itemId, {
    fromStatus: before.status,
    reason,
    delistAttemptIds,
  });
  await event(tx, itemId, "STOP_SELLING", {
    fromStatus: before.status,
    status,
    reason,
    delistAttemptIds,
  });
  return delistAttemptIds;
}
async function expireReservations(tx: Tx, itemId: string) {
  await tx.reservation.updateMany({
    where: { itemId, status: "ACTIVE", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}
@Injectable()
export class TradingService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  reserve(actor: Actor, itemId: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        customerRef: safeText(200).min(1),
        minutes: z.number().int().min(5).max(10080).default(120),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      actor.id,
      "item.reserve",
      key,
      { itemId, ...b },
      async (tx) => {
        const item = await itemLock(tx, itemId);
        await expireReservations(tx, itemId);
        if (!["AVAILABLE", "RESERVED"].includes(item.status))
          throw new Fault("NOT_AVAILABLE", "当前商品不可预留");
        if (
          await tx.reservation.findFirst({
            where: { itemId, status: "ACTIVE" },
          })
        )
          throw new Fault("ALREADY_RESERVED", "该实物已有有效预留");
        if (
          item.ownership === "SUPPLIER" &&
          !(await tx.offer.findFirst({
            where: {
              itemId,
              status: "CONFIRMED",
              canReserve: true,
              validUntil: { gt: new Date() },
            },
          }))
        )
          throw new Fault(
            "SUPPLIER_LOCK_UNCONFIRMED",
            "供应商未提供有效锁货承诺；请先确认，不建立虚假锁货",
          );
        const row = await tx.reservation.create({
          data: {
            itemId,
            ownerId: actor.id,
            customerRef: b.customerRef,
            expiresAt: new Date(Date.now() + b.minutes * 60000),
          },
        });
        await stop(tx, itemId, "RESERVED", actor.id, "客户预留");
        return { id: row.id };
      },
    );
  }
  release(actor: Actor, itemId: string, key: unknown) {
    return this.commands.run(
      actor.id,
      "item.release",
      key,
      { itemId },
      async (tx) => {
        const item = await itemLock(tx, itemId);
        const active = await tx.reservation.findMany({
          where: { itemId, status: "ACTIVE" },
        });
        if (
          active.some((x) => x.ownerId !== actor.id) &&
          actor.role !== "ADMIN"
        )
          throw new Fault("RESERVATION_OWNER", "不能解除他人预留", 403);
        await tx.reservation.updateMany({
          where: { itemId, status: "ACTIVE" },
          data: { status: "CANCELLED" },
        });
        if (item.status === "RESERVED")
          await tx.item.update({
            where: { id: itemId },
            data: { status: "PAUSED" },
          });
        await audit(tx, actor.id, "RESERVATION_RELEASED", itemId);
        await event(tx, itemId);
        return { id: itemId };
      },
    );
  }
  state(actor: Actor, itemId: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        state: z.enum([
          "PAUSED",
          "AVAILABLE",
          "GIFTED",
          "SELF_USE",
          "SUPPLIER_SOLD",
          "QUARANTINED",
        ]),
        reason: safeText(2000).min(1),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      actor.id,
      "item.state",
      key,
      { itemId, ...b },
      async (tx) => {
        const item = await itemLock(tx, itemId);
        await expireReservations(tx, itemId);
        const activeSale = await tx.sale.findFirst({
          where: { itemId, cycleNumber: item.cycle, returned: false },
        });
        const reserved = await tx.reservation.findFirst({
          where: { itemId, status: "ACTIVE" },
        });
        if (activeSale && b.state !== "PAUSED") {
          const observation = await tx.observation.create({
            data: {
              itemId,
              kind: "FULFILLMENT_CONFLICT",
              payload: json({
                state: b.state,
                reason: b.reason,
                saleId: activeSale.id,
              }),
            },
          });
          await stop(tx, itemId, "SOLD", actor.id, "已有订单的外部库存冲突");
          return { id: itemId, conflict: true, observationId: observation.id };
        }
        if (b.state === "AVAILABLE") {
          if (reserved) throw new Fault("RESERVED", "先处理已有预留");
          if (!["PAUSED", "QUARANTINED"].includes(item.status))
            throw new Fault(
              "REOPEN_DENIED",
              "仅暂停/已回收待复检商品可恢复，赠与或供应商售出不能直接复活",
            );
          if (!permission(actor.role, "review"))
            throw new Fault("REVIEW_REQUIRED", "恢复可售需要复核权限", 403);
          if (
            await tx.observation.findFirst({
              where: { itemId, resolved: false },
            })
          )
            throw new Fault("UNRESOLVED_CONFLICT", "请先处理未解决的库存冲突");
          await tx.item.update({
            where: { id: itemId },
            data: { status: "AVAILABLE" },
          });
          await audit(tx, actor.id, "INVENTORY_REOPENED", itemId, {
            reason: b.reason,
          });
          await event(tx, itemId);
          return { id: itemId };
        }
        if (b.state === "SUPPLIER_SOLD" && item.ownership !== "SUPPLIER")
          throw new Fault(
            "OWNERSHIP_MISMATCH",
            "自有商品不能登记为供应商售出",
            400,
          );
        if (
          reserved &&
          ["GIFTED", "SELF_USE", "SUPPLIER_SOLD"].includes(b.state)
        ) {
          const obs = await tx.observation.create({
            data: {
              itemId,
              kind: "RESERVATION_CONFLICT",
              payload: json({ state: b.state, reason: b.reason }),
            },
          });
          await stop(tx, itemId, "PAUSED", actor.id, "退出与预留冲突");
          return { id: itemId, conflict: true, observationId: obs.id };
        }
        await stop(
          tx,
          itemId,
          activeSale ? "SOLD" : b.state,
          actor.id,
          b.reason,
        );
        return { id: itemId };
      },
    );
  }
  intent(actor: Actor, itemId: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        customerRef: safeText(200).min(1),
        reason: safeText(2000).min(1),
        expiresAt: z.string().datetime(),
        pause: z.boolean().default(true),
      })
      .strict()
      .parse(raw);
    if (new Date(b.expiresAt) <= new Date())
      throw new Fault("EXPIRED", "例外意向必须在未来失效", 400);
    return this.commands.run(
      actor.id,
      "intent.create",
      key,
      { itemId, ...b },
      async (tx) => {
        const item = await itemLock(tx, itemId);
        if (!["AVAILABLE", "PAUSED"].includes(item.status))
          throw new Fault(
            "INTENT_TOO_LATE",
            "仅可为未售出、未被预留商品提前记录意向",
          );
        const row = await tx.exceptionIntent.create({
          data: {
            itemId,
            cycle: item.cycle,
            customerRef: b.customerRef,
            reason: b.reason,
            expiresAt: new Date(b.expiresAt),
            createdBy: actor.id,
          },
        });
        if (b.pause) await stop(tx, itemId, "PAUSED", actor.id, "朋友交易意向");
        await audit(tx, actor.id, "EXCEPTION_INTENT", itemId, {
          intentId: row.id,
        });
        return { id: row.id };
      },
    );
  }
  sold(actor: Actor, itemId: string, key: unknown, raw: unknown) {
    // Financial inputs deliberately are a separate command. Missing price/cost/exception cannot prevent the safety action.
    const b = z
      .object({
        channel: safeText(120).optional(),
        channelId: z.string().uuid().optional(),
        customerRef: safeText(200).default(""),
        externalKey: safeText(300).optional(),
        intentId: safeText(100).optional(),
        note: safeText(3000).default(""),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (!value.channel && !value.channelId)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["channel"],
            message: "请填写实际成交渠道或选择已配置账号",
          });
      })
      .parse(raw);
    return this.commands.run(
      actor.id,
      "item.sold",
      key,
      { itemId, ...b },
      async (tx) => {
        const item = await itemLock(tx, itemId);
        await expireReservations(tx, itemId);
        let channelName = b.channel || "";
        if (b.channelId) {
          const configured = await tx.channel.findUnique({
            where: { id: b.channelId },
          });
          if (!configured)
            throw new Fault("CHANNEL_NOT_FOUND", "所选渠道账号不存在", 400);
          // The immutable historical text is always the server-side account name,
          // never a caller-supplied label that might later be edited or spoofed.
          channelName = configured.name;
        }
        if (b.externalKey) {
          const old = await tx.sale.findUnique({
            where: { externalKey: b.externalKey },
          });
          if (old) {
            if (old.itemId !== itemId)
              throw new Fault(
                "EXTERNAL_KEY_CONFLICT",
                "外部订单已关联其他商品",
              );
            return { id: old.id, existing: true };
          }
        }
        const prior = await tx.sale.findFirst({
            where: { itemId, cycleNumber: item.cycle, returned: false },
          }),
          reservation = await tx.reservation.findFirst({
            where: { itemId, status: "ACTIVE" },
          });
        if (
          prior ||
          (reservation &&
            (reservation.ownerId !== actor.id ||
              reservation.customerRef !== b.customerRef)) ||
          ["GIFTED", "SELF_USE", "SUPPLIER_SOLD", "QUARANTINED"].includes(
            item.status,
          )
        ) {
          const obs = await tx.observation.create({
            data: {
              itemId,
              kind: prior ? "POSSIBLE_DUPLICATE_SALE" : "SALE_CONFLICT",
              payload: json({ ...b, priorSaleId: prior?.id || null }),
            },
          });
          await stop(
            tx,
            itemId,
            prior ? "SOLD" : "PAUSED",
            actor.id,
            "售出补录存在冲突，保留事实待核对",
          );
          return {
            id: itemId,
            conflict: true,
            observationId: obs.id,
            existingSaleId: prior?.id || null,
          };
        }
        let cooperation = "INCLUDED";
        let intentId: string | null = null;
        if (b.intentId) {
          const intent = await tx.exceptionIntent.findFirst({
            where: {
              id: /^[a-f0-9-]{36}$/i.test(b.intentId)
                ? b.intentId
                : "00000000-0000-0000-0000-000000000000",
              itemId,
              cycle: item.cycle,
              status: "ACTIVE",
              customerRef: b.customerRef,
              expiresAt: { gt: new Date() },
            },
          });
          cooperation = intent ? "EXCLUDED" : "PENDING_REVIEW";
          if (intent) {
            intentId = intent.id;
            await tx.exceptionIntent.update({
              where: { id: intent.id },
              data: { status: "USED" },
            });
          }
        }
        const activeCost =
          item.currency === "CNY"
            ? await tx.costEntry.aggregate({
                where: {
                  itemId,
                  cycleNumber: item.cycle,
                  status: "ACTIVE",
                  confirmed: true,
                  currency: "CNY",
                },
                _sum: { amount: true },
              })
            : null;
        const costSnapshot = activeCost?._sum.amount ?? null;
        const sale = await tx.sale.create({
          data: {
            itemId,
            cycleNumber: item.cycle,
            channel: channelName,
            channelId: b.channelId || null,
            customerRef: b.customerRef,
            externalKey: b.externalKey || null,
            cooperation,
            intentId,
            note: b.note,
            currency: item.currency,
            cost: costSnapshot,
            createdBy: actor.id,
          },
        });
        await tx.reservation.updateMany({
          where: { itemId, status: "ACTIVE" },
          data: { status: "CONSUMED" },
        });
        const delistAttemptIds = await stop(
          tx,
          itemId,
          "SOLD",
          actor.id,
          "我方已售出，财务待补",
        );
        await audit(tx, actor.id, "SALE_RECORDED", itemId, {
          saleId: sale.id,
          cooperation,
          costSnapshot,
          delistAttemptIds,
        });
        return { id: sale.id, delistAttemptIds };
      },
    );
  }
  convertInquiry(actor: Actor, inquiryId: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        version: expectedVersion,
        externalKey: safeText(300).optional(),
        note: safeText(3000).default(""),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      actor.id,
      "inquiry.convert",
      key,
      { inquiryId, ...b },
      async (tx) => {
        const found = await tx.inquiry.findUniqueOrThrow({
          where: { id: inquiryId },
        });
        const item = await itemLock(tx, found.itemId);
        await expireReservations(tx, item.id);
        const inquiry = await tx.inquiry.findUniqueOrThrow({
          where: { id: inquiryId },
        });
        if (inquiry.version !== b.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "这条询盘刚被更新。请核对最新沟通记录后再确认成交。",
            409,
          );
        if (!["OPEN", "FOLLOWUP"].includes(inquiry.state))
          throw new Fault(
            "INQUIRY_NOT_CONVERTIBLE",
            "只有待跟进或跟进中的询盘可以确认成交",
            409,
          );
        const priorInquirySale = await tx.sale.findUnique({
          where: { inquiryId },
        });
        if (priorInquirySale)
          throw new Fault(
            "INQUIRY_ALREADY_CONVERTED",
            "该询盘已经转化为成交，不能重复确认",
            409,
          );
        if (!["AVAILABLE", "RESERVED"].includes(item.status))
          throw new Fault(
            "ITEM_NOT_AVAILABLE",
            "商品已不在可成交状态，不能将此询盘转为成交",
            409,
          );
        const priorSale = await tx.sale.findFirst({
          where: { itemId: item.id, cycleNumber: item.cycle, returned: false },
        });
        if (priorSale)
          throw new Fault(
            "ITEM_ALREADY_SOLD",
            "该实物当前周期已有成交记录，不能重复转化询盘",
            409,
          );
        const reservation = await tx.reservation.findFirst({
          where: { itemId: item.id, status: "ACTIVE" },
        });
        if (
          (item.status === "RESERVED" && !reservation) ||
          (reservation &&
            (reservation.ownerId !== actor.id ||
              reservation.customerRef !== inquiry.customerRef))
        )
          throw new Fault(
            "RESERVATION_CONFLICT",
            "该商品的有效预留与当前询盘不一致，请先由预留负责人核对",
            409,
          );
        if (b.externalKey) {
          const old = await tx.sale.findUnique({
            where: { externalKey: b.externalKey },
          });
          if (old)
            throw new Fault(
              "EXTERNAL_KEY_CONFLICT",
              "外部订单唯一键已经关联成交，不能重复转化",
              409,
            );
        }
        const activeCost =
          item.currency === "CNY"
            ? await tx.costEntry.aggregate({
                where: {
                  itemId: item.id,
                  cycleNumber: item.cycle,
                  status: "ACTIVE",
                  confirmed: true,
                  currency: "CNY",
                },
                _sum: { amount: true },
              })
            : null;
        const costSnapshot = activeCost?._sum.amount ?? null;
        const sale = await tx.sale.create({
          data: {
            itemId: item.id,
            cycleNumber: item.cycle,
            channel: inquiry.channel,
            channelId: inquiry.channelId,
            inquiryId,
            customerRef: inquiry.customerRef,
            externalKey: b.externalKey || null,
            cooperation: "INCLUDED",
            note: b.note,
            currency: item.currency,
            cost: costSnapshot,
            createdBy: actor.id,
          },
        });
        await tx.reservation.updateMany({
          where: { itemId: item.id, status: "ACTIVE" },
          data: { status: "CONSUMED" },
        });
        const delistAttemptIds = await stop(
          tx,
          item.id,
          "SOLD",
          actor.id,
          "询盘确认成交，财务待补",
        );
        const converted = await tx.inquiry.update({
          where: { id: inquiryId },
          data: { state: "WON", version: { increment: 1 } },
        });
        await audit(tx, actor.id, "SALE_RECORDED", item.id, {
          saleId: sale.id,
          inquiryId,
          cooperation: "INCLUDED",
          costSnapshot,
          delistAttemptIds,
        });
        await audit(tx, actor.id, "INQUIRY_CONVERTED", item.id, {
          inquiryId,
          saleId: sale.id,
          version: converted.version,
        });
        return {
          id: sale.id,
          inquiryId,
          inquiryVersion: converted.version,
          delistAttemptIds,
        };
      },
    );
  }
  async finance(actor: Actor, saleId: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        version: expectedVersion,
        amount,
        cost: amount,
        fees: amount,
        currency,
        paid: z.boolean(),
        note: safeText(4000).default(""),
      })
      .strict()
      .parse(raw);
    const sale = await this.db.sale.findUniqueOrThrow({
      where: { id: saleId },
    });
    return this.commands.run(
      actor.id,
      "sale.finance",
      key,
      { saleId, ...b },
      async (tx) => {
        await itemLock(tx, sale.itemId);
        const current = await tx.sale.findUniqueOrThrow({
          where: { id: saleId },
        });
        versionMatch(current.version, b.version);
        if (
          b.currency !== current.currency &&
          (await tx.settlementLine.findFirst({
            where: { saleId, statement: { status: "CONFIRMED" } },
          }))
        )
          throw new Fault(
            "CLOSED_CURRENCY",
            "已进入确认快照的交易不得直接改币种，请先核对更正处理",
          );
        if (
          current.refunded > 0 &&
          (b.amount !== current.amount ||
            b.currency !== current.currency ||
            b.cost !== current.cost)
        )
          throw new Fault(
            "ADJUSTMENT_LOCK",
            "退款后的成交额、币种和取得成本不能直接改写",
          );
        const { version: _version, ...data } = b;
        void _version;
        await tx.sale.update({
          where: { id: saleId },
          data: { ...data, version: { increment: 1 } },
        });
        await audit(tx, actor.id, "SALE_FINANCE_UPDATED", sale.itemId, {
          saleId,
          version: b.version + 1,
        });
        return { id: saleId };
      },
    );
  }
  async refund(actor: Actor, saleId: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        amount: z.number().int().positive().max(2000000000),
        reason: safeText(2000).min(1),
      })
      .strict()
      .parse(raw);
    const sale = await this.db.sale.findUniqueOrThrow({
      where: { id: saleId },
    });
    return this.commands.run(
      actor.id,
      "sale.refund",
      key,
      { saleId, ...b },
      async (tx) => {
        await itemLock(tx, sale.itemId);
        const s = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
        if (s.amount === null || s.refunded + b.amount > s.amount)
          throw new Fault(
            "REFUND_LIMIT",
            "先补成交金额，退款累计不能超过成交金额",
          );
        await tx.adjustment.create({
          data: {
            saleId,
            amount: b.amount,
            reason: b.reason,
            createdBy: actor.id,
          },
        });
        await tx.sale.update({
          where: { id: saleId },
          data: {
            refunded: { increment: b.amount },
            version: { increment: 1 },
          },
        });
        await audit(tx, actor.id, "REFUND_RECORDED", sale.itemId, { saleId });
        return { id: saleId };
      },
    );
  }
  async returned(actor: Actor, saleId: string, key: unknown, raw: unknown) {
    const b = z
      .object({ evidence: safeText(2000).min(1), intact: z.literal(true) })
      .strict()
      .parse(raw);
    const sale = await this.db.sale.findUniqueOrThrow({
      where: { id: saleId },
    });
    return this.commands.run(
      actor.id,
      "sale.return",
      key,
      { saleId, ...b },
      async (tx) => {
        await itemLock(tx, sale.itemId);
        const s = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
        if (s.returned) return { id: saleId, existing: true };
        if (s.amount === null || s.refunded !== s.amount)
          throw new Fault(
            "RETURN_REVIEW",
            "本版自动成本恢复仅支持全额退款、完整回收；其他情况保留为人工核对",
          );
        await tx.sale.update({
          where: { id: saleId },
          data: {
            returned: true,
            state: "RETURNED",
            version: { increment: 1 },
          },
        });
        await tx.exceptionIntent.updateMany({
          where: { itemId: sale.itemId, status: "ACTIVE" },
          data: { status: "CANCELLED" },
        });
        await stop(
          tx,
          sale.itemId,
          "QUARANTINED",
          actor.id,
          "已回收，须复检后恢复销售",
        );
        await audit(tx, actor.id, "RETURN_RECEIVED", sale.itemId, {
          saleId,
          evidence: b.evidence,
        });
        return { id: saleId };
      },
    );
  }
}
