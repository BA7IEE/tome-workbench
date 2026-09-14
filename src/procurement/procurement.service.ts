import { Injectable } from "@nestjs/common";
import { hash, json, lock, type Tx } from "../common/transaction";
import { Fault } from "../common/errors";
import { asDate, lineData, normalizedOrderSnapshot } from "./procurement.logic";
import type { PurchaseOrderImportInput } from "./procurement.schemas";

@Injectable()
export class ProcurementService {
  validate(b: PurchaseOrderImportInput) {
    const duplicate = (values: string[]) =>
      new Set(values).size !== values.length;
    if (duplicate(b.lines.map((x) => x.lineKey)))
      throw new Fault("DUPLICATE_PURCHASE_LINE", "同一订单的订单行键重复", 400);
    if (duplicate(b.adjustments.map((x) => x.adjustmentKey)))
      throw new Fault(
        "DUPLICATE_ORDER_ADJUSTMENT",
        "同一订单的金额调整键重复",
        400,
      );
    if (duplicate(b.shipments.map((x) => x.shipmentKey)))
      throw new Fault("DUPLICATE_SHIPMENT", "同一订单的包裹键重复", 400);
    if (duplicate(b.returns.map((x) => x.returnKey)))
      throw new Fault("DUPLICATE_RETURN", "同一订单的退货键重复", 400);
    const lineKeys = new Set(b.lines.map((x) => x.lineKey));
    for (const s of [...b.shipments, ...b.returns])
      for (const key of s.lineKeys)
        if (!lineKeys.has(key))
          throw new Fault(
            "UNKNOWN_PURCHASE_LINE",
            `包裹或退货引用了不存在的订单行：${key}`,
            400,
          );
  }
  async importInTx(tx: Tx, b: PurchaseOrderImportInput) {
    this.validate(b);
    await lock(
      tx,
      `procurement-order:${b.procurementSourceId}:${b.externalOrderNo}`,
    );
    const source = await tx.procurementSource.findUnique({
      where: { id: b.procurementSourceId },
    });
    if (!source?.active)
      throw new Fault(
        "PROCUREMENT_SOURCE_UNAVAILABLE",
        "采购来源不存在或已停用",
        400,
      );
    const snap = normalizedOrderSnapshot(b),
      snapHash = hash(snap);
    let order = await tx.purchaseOrder.findUnique({
      where: {
        procurementSourceId_externalOrderNo: {
          procurementSourceId: b.procurementSourceId,
          externalOrderNo: b.externalOrderNo,
        },
      },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (order?.revisions[0] && hash(order.revisions[0].snapshot) === snapHash) {
      const lines = await tx.purchaseLine.findMany({
        where: { orderId: order.id },
        select: { id: true, lineKey: true, version: true },
      });
      return {
        id: order.id,
        version: order.version,
        lineCount: lines.length,
        unchanged: true,
        lines,
      };
    }
    const orderValues = {
      orderedAt: asDate(b.orderedAt),
      sourceStatusRaw: b.sourceStatusRaw,
      returnabilityRaw: b.returnabilityRaw,
      currency: b.currency,
      subtotalAmount: b.subtotalAmount,
      totalAmount: b.totalAmount,
      paymentAmount: b.paymentAmount,
      rawPayload: json(b.rawPayload),
    };
    order = order
      ? await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { ...orderValues, version: { increment: 1 } },
          include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        })
      : await tx.purchaseOrder.create({
          data: {
            procurementSourceId: b.procurementSourceId,
            externalOrderNo: b.externalOrderNo,
            ...orderValues,
          },
          include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        });
    await tx.purchaseOrderRevision.create({
      data: { orderId: order.id, version: order.version, snapshot: json(snap) },
    });
    for (const a of b.adjustments)
      await tx.purchaseOrderAdjustment.upsert({
        where: {
          orderId_adjustmentKey: {
            orderId: order.id,
            adjustmentKey: a.adjustmentKey,
          },
        },
        create: { orderId: order.id, ...a },
        update: {
          kind: a.kind,
          label: a.label,
          amount: a.amount,
          currency: a.currency,
        },
      });
    const existing = await tx.purchaseLine.findMany({
      where: { orderId: order.id },
      include: {
        purchaseLineRevisions: { orderBy: { version: "desc" }, take: 1 },
      },
    });
    const byKey = new Map(existing.map((x) => [x.lineKey, x])),
      ids = new Map<string, string>();
    for (const line of b.lines) {
      const old = byKey.get(line.lineKey),
        latest = old?.purchaseLineRevisions[0];
      let currentId = old?.id || "",
        currentVersion = old?.version || 0;
      if (!old) {
        const created = await tx.purchaseLine.create({
          data: { orderId: order.id, ...lineData(line) },
        });
        currentId = created.id;
        currentVersion = created.version;
        await tx.purchaseLineRevision.create({
          data: {
            lineId: currentId,
            version: currentVersion,
            snapshot: json(line),
          },
        });
      } else if (!latest || hash(latest.snapshot) !== hash(line)) {
        const updated = await tx.purchaseLine.update({
          where: { id: old.id },
          data: { ...lineData(line), version: { increment: 1 } },
        });
        currentId = updated.id;
        currentVersion = updated.version;
        await tx.purchaseLineRevision.create({
          data: {
            lineId: currentId,
            version: currentVersion,
            snapshot: json(line),
          },
        });
      }
      ids.set(line.lineKey, currentId);
    }
    for (const s of b.shipments) {
      const row = await tx.purchaseShipment.upsert({
        where: {
          orderId_shipmentKey: {
            orderId: order.id,
            shipmentKey: s.shipmentKey,
          },
        },
        create: {
          orderId: order.id,
          shipmentKey: s.shipmentKey,
          externalShipmentRef: s.externalShipmentRef,
          carrier: s.carrier,
          statusRaw: s.statusRaw,
          shippedAt: asDate(s.shippedAt),
          deliveredAt: asDate(s.deliveredAt),
          rawPayload: json(s.rawPayload),
        },
        update: {
          externalShipmentRef: s.externalShipmentRef,
          carrier: s.carrier,
          statusRaw: s.statusRaw,
          shippedAt: asDate(s.shippedAt),
          deliveredAt: asDate(s.deliveredAt),
          rawPayload: json(s.rawPayload),
        },
      });
      await tx.purchaseShipmentLine.deleteMany({
        where: { shipmentId: row.id },
      });
      if (s.lineKeys.length)
        await tx.purchaseShipmentLine.createMany({
          data: s.lineKeys.map((key) => ({
            shipmentId: row.id,
            lineId: ids.get(key)!,
          })),
        });
    }
    for (const ret of b.returns) {
      const row = await tx.purchaseReturn.upsert({
        where: {
          orderId_returnKey: { orderId: order.id, returnKey: ret.returnKey },
        },
        create: {
          orderId: order.id,
          returnKey: ret.returnKey,
          externalReturnRef: ret.externalReturnRef,
          statusRaw: ret.statusRaw,
          openedAt: asDate(ret.openedAt),
          rawPayload: json(ret.rawPayload),
        },
        update: {
          externalReturnRef: ret.externalReturnRef,
          statusRaw: ret.statusRaw,
          openedAt: asDate(ret.openedAt),
          rawPayload: json(ret.rawPayload),
        },
      });
      await tx.purchaseReturnLine.deleteMany({ where: { returnId: row.id } });
      if (ret.lineKeys.length)
        await tx.purchaseReturnLine.createMany({
          data: ret.lineKeys.map((key) => ({
            returnId: row.id,
            lineId: ids.get(key)!,
          })),
        });
    }
    const lines = await tx.purchaseLine.findMany({
      where: { orderId: order.id },
      select: { id: true, lineKey: true, version: true },
    });
    return {
      id: order.id,
      version: order.version,
      lineCount: lines.length,
      unchanged: false,
      lines,
    };
  }
}
