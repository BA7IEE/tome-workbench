import { ProcurementService } from "./procurement.service";
import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit, json, lock } from "../common/transaction";
import { Fault } from "../common/errors";
import { safeText, uuid } from "../common/domain";
import { itemLock, versionMatch } from "../catalog/catalog.service";
import {
  procurementSourceKey,
  sourceCandidatePayload,
} from "./procurement.logic";
import {
  procurementSourceInput,
  purchaseCostConfirm,
  purchaseLineLink,
  purchaseLineReview,
  purchaseOrderImport,
  voidPurchaseCost,
} from "./procurement.schemas";

@ApiTags("采购来源与订单")
@Controller("api/procurement")
export class ProcurementController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private procurement: ProcurementService,
  ) {}

  @Access("supply") @Get("sources") sources() {
    return this.db.procurementSource.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { supplier: true, _count: { select: { orders: true } } },
    });
  }

  @Access("supply") @Post("sources") createSource(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = procurementSourceInput.parse(raw);
    return this.commands.run(
      r.actor.id,
      "procurement.source.create",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        await lock(tx, "procurement-source:" + b.code);
        const old = await tx.procurementSource.findUnique({
          where: { code: b.code },
        });
        if (old) return { id: old.id, existing: true };
        const row = await tx.procurementSource.create({ data: b });
        await audit(tx, r.actor.id, "PROCUREMENT_SOURCE_CREATED", row.id, {
          code: row.code,
          name: row.name,
        });
        return { id: row.id };
      },
    );
  }

  @Access("supply") @Get("orders") async orders(@Query() raw: unknown) {
    const b = z
      .object({
        q: safeText(150).default(""),
        sourceId: z.union([uuid, z.literal("")]).default(""),
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .strict()
      .parse(raw);
    const start = b.month ? new Date(b.month + "-01T00:00:00+08:00") : null;
    const next = b.month
      ? new Date(
          Date.UTC(Number(b.month.slice(0, 4)), Number(b.month.slice(5)), 1) -
            8 * 3600000,
        )
      : null;
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(start && next ? { orderedAt: { gte: start, lt: next } } : {}),
      ...(b.sourceId ? { procurementSourceId: b.sourceId } : {}),
      ...(b.q
        ? {
            OR: [
              { externalOrderNo: { contains: b.q, mode: "insensitive" } },
              {
                procurementSource: {
                  name: { contains: b.q, mode: "insensitive" },
                },
              },
              {
                lines: {
                  some: {
                    OR: [
                      { sourceSku: { contains: b.q, mode: "insensitive" } },
                      { title: { contains: b.q, mode: "insensitive" } },
                      { brandRaw: { contains: b.q, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.purchaseOrder.count({ where }),
      this.db.purchaseOrder.findMany({
        where,
        orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
        take: 30,
        skip: (b.page - 1) * 30,
        include: {
          procurementSource: true,
          _count: { select: { lines: true, shipments: true, returns: true } },
        },
      }),
    ]);
    return { total, page: b.page, size: 30, rows };
  }
  @Access("supply") @Get("orders/:id") order(@Param("id") rawId: string) {
    const id = uuid.parse(rawId);
    return this.db.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: {
        procurementSource: true,
        costBasis: true,
        adjustments: { orderBy: { createdAt: "asc" } },
        lines: {
          orderBy: { createdAt: "asc" },
          include: {
            itemLink: {
              include: {
                item: {
                  select: { id: true, serial: true, title: true, brand: true },
                },
              },
            },
            ingestCandidates: {
              select: { id: true, assets: { select: { id: true } } },
            },
            sourceCandidate: {
              select: { id: true, sourceKey: true, title: true },
            },
            costConfirmations: {
              where: { voidedAt: null },
              orderBy: { confirmedAt: "desc" },
              take: 1,
            },
          },
        },
        shipments: { orderBy: { createdAt: "asc" }, include: { lines: true } },
        returns: { orderBy: { createdAt: "asc" }, include: { lines: true } },
        revisions: { orderBy: { version: "desc" }, take: 10 },
      },
    });
  }

  @Access("supply") @Get("lines/:id/revisions") lineRevisions(
    @Param("id") rawId: string,
  ) {
    return this.db.purchaseLineRevision.findMany({
      where: { lineId: uuid.parse(rawId) },
      orderBy: { version: "desc" },
      take: 30,
    });
  }

  @Access("supply") @Post("orders/import") importOrder(
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = purchaseOrderImport.parse(raw);
    return this.commands.run(
      r.actor.id,
      "procurement.order.import",
      r.get("Idempotency-Key"),
      b,
      async (tx) => {
        const result = await this.procurement.importInTx(tx, b);
        await audit(tx, r.actor.id, "PURCHASE_ORDER_IMPORTED", result.id, {
          procurementSourceId: b.procurementSourceId,
          externalOrderNo: b.externalOrderNo,
          version: result.version,
          lineCount: result.lineCount,
          shipmentCount: b.shipments.length,
          returnCount: b.returns.length,
          unchanged: result.unchanged,
        });
        return result;
      },
    );
  }

  @Access("supply") @Post("lines/:id/review") reviewLine(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = purchaseLineReview.parse(raw);
    return this.commands.run(
      r.actor.id,
      "procurement.line.review",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await lock(tx, "purchase-line:" + id);
        const line = await tx.purchaseLine.findUniqueOrThrow({ where: { id } });
        versionMatch(line.version, b.version);
        const updated = await tx.purchaseLine.update({
          where: { id },
          data: {
            businessDecision: b.businessDecision,
            possession: b.possession,
            reviewNote: b.reviewNote,
            version: { increment: 1 },
          },
        });
        await audit(tx, r.actor.id, "PURCHASE_LINE_REVIEWED", id, {
          before: {
            businessDecision: line.businessDecision,
            possession: line.possession,
          },
          after: {
            businessDecision: updated.businessDecision,
            possession: updated.possession,
          },
          note: b.reviewNote,
        });
        return {
          id,
          version: updated.version,
          businessDecision: updated.businessDecision,
          possession: updated.possession,
        };
      },
    );
  }

  @Access("supply") @Post("lines/:id/source-candidate") sourceCandidate(
    @Param("id") rawId: string,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId);
    return this.commands.run(
      r.actor.id,
      "procurement.line.sourceCandidate",
      r.get("Idempotency-Key"),
      { id },
      async (tx) => {
        await lock(tx, "purchase-line:" + id);
        const line = await tx.purchaseLine.findUniqueOrThrow({
          where: { id },
          include: {
            order: { include: { procurementSource: true } },
            sourceCandidate: true,
          },
        });
        if (line.sourceCandidate)
          return { id: line.sourceCandidate.id, existing: true };
        if (
          line.businessDecision !== "INCLUDE" ||
          line.possession !== "IN_HAND"
        )
          throw new Fault(
            "PURCHASE_LINE_NOT_READY",
            "只有明确确认“纳入经营”且“实物在手”的订单行才能生成货源候选",
            400,
          );
        const sourceKey = procurementSourceKey(
          line.order.procurementSource.code,
          line.order.externalOrderNo,
          line,
        );
        await lock(tx, "sourceKey:" + sourceKey);
        const payload = sourceCandidatePayload(
          line.order.procurementSource.name,
          line.order.externalOrderNo,
          line,
        );
        const old = await tx.source.findUnique({ where: { sourceKey } });
        if (old) return { id: old.id, existing: true };
        const source = await tx.source.create({
          data: {
            sourceKey,
            title: line.title,
            purchaseLineId: line.id,
            payload: json(payload),
          },
        });
        await tx.sourceRevision.create({
          data: { sourceId: source.id, version: 1, payload: json(payload) },
        });
        await audit(tx, r.actor.id, "PURCHASE_LINE_SOURCE_CREATED", line.id, {
          sourceId: source.id,
          sourceKey,
        });
        return { id: source.id, sourceKey };
      },
    );
  }

  @Access("edit") @Post("lines/:id/link-item") linkItem(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = purchaseLineLink.parse(raw);
    return this.commands.run(
      r.actor.id,
      "procurement.line.linkItem",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await lock(tx, "purchase-line:" + id);
        await itemLock(tx, b.itemId);
        const line = await tx.purchaseLine.findUniqueOrThrow({
          where: { id },
          include: {
            order: { include: { procurementSource: true } },
            sourceCandidate: true,
          },
        });
        const old = await tx.itemPurchaseLink.findUnique({
          where: { purchaseLineId: id },
        });
        if (old) {
          if (old.itemId !== b.itemId)
            throw new Fault(
              "PURCHASE_LINE_ALREADY_LINKED",
              "该采购订单行已经关联另一件TM商品",
              409,
            );
          return { purchaseLineId: id, itemId: b.itemId, existing: true };
        }
        await tx.itemPurchaseLink.create({
          data: {
            purchaseLineId: id,
            itemId: b.itemId,
            linkedBy: r.actor.id,
            note: b.note,
          },
        });
        let source = line.sourceCandidate;
        if (!source) {
          const sourceKey = procurementSourceKey(
            line.order.procurementSource.code,
            line.order.externalOrderNo,
            line,
          );
          await lock(tx, "sourceKey:" + sourceKey);
          source = await tx.source.findUnique({ where: { sourceKey } });
          if (!source) {
            const payload = sourceCandidatePayload(
              line.order.procurementSource.name,
              line.order.externalOrderNo,
              line,
            );
            source = await tx.source.create({
              data: {
                sourceKey,
                title: line.title,
                purchaseLineId: line.id,
                payload: json(payload),
              },
            });
            await tx.sourceRevision.create({
              data: { sourceId: source.id, version: 1, payload: json(payload) },
            });
          }
        }
        await tx.itemSourceLink.upsert({
          where: { itemId_sourceId: { itemId: b.itemId, sourceId: source.id } },
          create: {
            itemId: b.itemId,
            sourceId: source.id,
            linkedBy: r.actor.id,
            note: b.note || "采购订单行关联已有TM",
          },
          update: {},
        });
        await audit(tx, r.actor.id, "PURCHASE_LINE_ITEM_LINKED", b.itemId, {
          purchaseLineId: id,
          note: b.note,
        });
        return { purchaseLineId: id, itemId: b.itemId };
      },
    );
  }

  @Access("finance") @Post("lines/:id/cost-confirmations") confirmCost(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = purchaseCostConfirm.parse(raw);
    return this.commands.run(
      r.actor.id,
      "procurement.cost.confirm",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await lock(tx, "financial-journal");
        await lock(tx, "purchase-line:" + id);
        await tx.purchaseLine.findUniqueOrThrow({ where: { id } });
        const active = await tx.purchaseCostConfirmation.findFirst({
          where: { purchaseLineId: id, voidedAt: null },
        });
        if (active) {
          if (
            active.amountCny === b.amountCny &&
            active.basis === b.basis &&
            active.note === b.note
          )
            return { id: active.id, existing: true };
          throw new Fault(
            "PURCHASE_COST_ALREADY_CONFIRMED",
            "该订单行已有有效人民币成本；请先作废旧确认，再录入新的依据",
            409,
          );
        }
        const row = await tx.purchaseCostConfirmation.create({
          data: {
            purchaseLineId: id,
            amountCny: b.amountCny,
            basis: b.basis,
            note: b.note,
            confirmedBy: r.actor.id,
          },
        });
        await audit(tx, r.actor.id, "PURCHASE_COST_CONFIRMED", id, {
          confirmationId: row.id,
          amountCny: b.amountCny,
          basis: b.basis,
        });
        return { id: row.id };
      },
    );
  }
  @Access("finance") @Post("cost-confirmations/:id/void") async voidCost(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = voidPurchaseCost.parse(raw);
    const existing = await this.db.purchaseCostConfirmation.findUniqueOrThrow({
      where: { id },
    });
    return this.commands.run(
      r.actor.id,
      "procurement.cost.void",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await lock(tx, "financial-journal");
        await lock(tx, "purchase-line:" + existing.purchaseLineId);
        const row = await tx.purchaseCostConfirmation.findUniqueOrThrow({
          where: { id },
        });
        if (row.voidedAt) return { id, existing: true };
        await tx.purchaseCostConfirmation.update({
          where: { id },
          data: { voidedAt: new Date(), voidReason: b.reason },
        });
        await audit(
          tx,
          r.actor.id,
          "PURCHASE_COST_VOIDED",
          row.purchaseLineId,
          { confirmationId: id, reason: b.reason },
        );
        return { id };
      },
    );
  }
}
