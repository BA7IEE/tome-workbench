import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit, event, json } from "../common/transaction";
import { expectedVersion, safeText, tm, uuid } from "../common/domain";
import { Fault } from "../common/errors";
import { itemLock, snapshot, versionMatch } from "./catalog.service";
import { PublicationHealthService } from "../distribution/publication-health.service";
const mutation = z
  .object({
    version: expectedVersion,
    reason: safeText(500).min(1),
    confirmed: z.literal(true),
  })
  .strict();
@ApiTags("商品删除与恢复")
@Controller("api")
export class TrashController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private publicationHealth: PublicationHealthService,
  ) {}
  @Access("delete") @Get("recycle-bin/items") async list(
    @Query() raw: unknown,
  ) {
    const b = z
      .object({
        q: safeText(150).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .strict()
      .parse(raw);
    const serial = /^TM\d{6,}$/i.test(b.q) ? Number(b.q.slice(2)) : null;
    const where: Prisma.ItemWhereInput = {
      deletedAt: { not: null },
      ...(b.q
        ? {
            OR: [
              { title: { contains: b.q, mode: "insensitive" } },
              { brand: { contains: b.q, mode: "insensitive" } },
              { aliases: { some: { code: { contains: b.q.toUpperCase() } } } },
              ...(serial && Number.isSafeInteger(serial) ? [{ serial }] : []),
            ],
          }
        : {}),
    };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.item.count({ where }),
          page = Math.min(b.page, Math.max(1, Math.ceil(total / 30)));
        const rows = await tx.item.findMany({
          where,
          orderBy: [{ deletedAt: "desc" }, { serial: "desc" }],
          take: 30,
          skip: (page - 1) * 30,
          select: {
            id: true,
            serial: true,
            title: true,
            brand: true,
            version: true,
            deletedAt: true,
            deletionReason: true,
            dataMode: true,
          },
        });
        return {
          total,
          page,
          size: 30,
          rows: rows.map((i) => ({ ...i, code: tm(i.serial) })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  @Access("delete") @Post("items/:id/trash") trash(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = mutation.parse(raw);
    return this.commands.run(
      r.actor.id,
      "item.trash",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        const item = await itemLock(tx, id, true);
        if (item.deletedAt)
          return { id, code: tm(item.serial), alreadyDeleted: true };
        versionMatch(item.version, b.version);
        if (await tx.sale.count({ where: { itemId: id } }))
          throw new Fault(
            "TRASH_HAS_SALES",
            "该商品已有成交或退款记录，不能删除；请在成交记录中处理，避免破坏账目",
          );
        if (await tx.costEntry.count({ where: { itemId: id } }))
          throw new Fault(
            "TRASH_HAS_COSTS",
            "该商品已有成本记录，不能删除；请保留经营记录并暂停推广",
          );
        if (
          await tx.observation.count({ where: { itemId: id, resolved: false } })
        )
          throw new Fault(
            "TRASH_HAS_CONFLICT",
            "该商品有未解决的库存冲突，请先核对处理",
          );
        if (
          await tx.reservation.count({
            where: {
              itemId: id,
              status: "ACTIVE",
              expiresAt: { gt: new Date() },
            },
          })
        )
          throw new Fault(
            "TRASH_RESERVED",
            "该商品仍有客户预留，请先解除预留，再删除",
          );
        if (!["AVAILABLE", "PAUSED", "RESERVED"].includes(item.status))
          throw new Fault(
            "TRASH_STATE_PROTECTED",
            "已售出、赠出、自留或退货中的商品不能直接删除，请保留实际经营记录",
          );
        // PENDING has not left ToMe and may be cancelled locally. Every
        // handed-off, unknown, successful or unresolved stop fact is a
        // possible remote exposure and must be settled before deletion.
        const cancelledAttemptIds =
          await this.publicationHealth.cancelPendingPublicationAttempts(
            tx,
            id,
            r.actor.id,
            "商品移入回收站前取消尚未交付的发布资料",
          );
        const distributionBlockers =
          await this.publicationHealth.distributionExposureBlockers(tx, id);
        if (distributionBlockers.length)
          throw new Fault(
            "TRASH_DISTRIBUTION_EXPOSURE",
            "该商品仍可能在线或有未完成停售交付；请先登记来源关联的下架结果，再删除",
          );
        await tx.reservation.updateMany({
          where: {
            itemId: id,
            status: "ACTIVE",
            expiresAt: { lte: new Date() },
          },
          data: { status: "EXPIRED" },
        });
        const updated = await tx.item.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedBy: r.actor.id,
            deletionReason: b.reason,
            status: "PAUSED",
            approvedValid: false,
            version: { increment: 1 },
          },
        });
        await tx.itemRevision.create({
          data: {
            itemId: id,
            version: updated.version,
            snapshot: json(await snapshot(tx, updated)),
          },
        });
        await tx.task.updateMany({
          where: { itemId: id, kind: "PREPARE", status: "OPEN" },
          data: { status: "CANCELLED" },
        });
        await tx.exceptionIntent.updateMany({
          where: { itemId: id, status: "ACTIVE" },
          data: { status: "CANCELLED" },
        });
        await audit(tx, r.actor.id, "ITEM_TRASHED", id, {
          reason: b.reason,
          previousStatus: item.status,
          code: tm(item.serial),
          cancelledAttemptIds,
        });
        await event(tx, id, "ITEM_TRASHED");
        return {
          id,
          code: tm(item.serial),
          version: updated.version,
          deleted: true,
        };
      },
    );
  }
  @Access("delete") @Post("items/:id/restore") restore(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = mutation.parse(raw);
    return this.commands.run(
      r.actor.id,
      "item.restore",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        const item = await itemLock(tx, id, true);
        if (!item.deletedAt)
          throw new Fault("ITEM_NOT_DELETED", "商品不在回收站，无需恢复");
        versionMatch(item.version, b.version);
        const updated = await tx.item.update({
          where: { id },
          data: {
            deletedAt: null,
            deletedBy: null,
            deletionReason: "",
            status: "PAUSED",
            approvedValid: false,
            version: { increment: 1 },
          },
        });
        await tx.itemRevision.create({
          data: {
            itemId: id,
            version: updated.version,
            snapshot: json(await snapshot(tx, updated)),
          },
        });
        await audit(tx, r.actor.id, "ITEM_RESTORED", id, {
          reason: b.reason,
          deletedAt: item.deletedAt,
          deletionReason: item.deletionReason,
          code: tm(item.serial),
        });
        await event(tx, id, "ITEM_RESTORED");
        return {
          id,
          code: tm(item.serial),
          version: updated.version,
          status: "PAUSED",
        };
      },
    );
  }
}
