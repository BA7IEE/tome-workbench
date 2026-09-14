import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthRequest, permission } from "../auth/auth";
import { Commands, audit, event } from "../common/transaction";
import { PrismaService } from "../database/prisma.service";
import { itemLock } from "../catalog/catalog.service";
import { safeText, uuid } from "../common/domain";
import { Fault } from "../common/errors";
@Controller("api")
export class MediaActionsController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Access("edit") @Post("items/:id/image-order") order(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        expectedOrder: z.array(uuid).max(200),
        assetIds: z.array(uuid).max(200),
      })
      .strict()
      .parse(raw);
    return this.commands.run(
      r.actor.id,
      "asset.order",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        await itemLock(tx, id);
        const rows = await tx.asset.findMany({
          where: { itemId: id, archived: false, role: { not: "DOCUMENT" } },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (
          JSON.stringify(rows.map((a) => a.id)) !==
          JSON.stringify(b.expectedOrder)
        )
          throw new Fault(
            "IMAGE_ORDER_CONFLICT",
            "图片列表已变化，请刷新后重新排序",
          );
        if (
          rows.length !== b.assetIds.length ||
          new Set(b.assetIds).size !== rows.length ||
          b.assetIds.some((id) => !rows.some((a) => a.id === id))
        )
          throw new Fault(
            "IMAGE_SET_MISMATCH",
            "必须对本商品全部展示图片排序",
            400,
          );
        for (const [position, assetId] of b.assetIds.entries())
          await tx.asset.update({ where: { id: assetId }, data: { position } });
        await audit(tx, r.actor.id, "IMAGE_ORDER_CHANGED", id, {
          assetIds: b.assetIds,
        });
        await event(tx, id);
        return { id };
      },
    );
  }
  @Access("edit") @Post("assets/:id/archive") async archive(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({ archived: z.boolean(), reason: safeText(1000).min(1) })
      .strict()
      .parse(raw);
    const asset = await this.db.asset.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
    if (asset.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
      throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
    return this.commands.run(
      r.actor.id,
      "asset.archive",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await itemLock(tx, asset.itemId);
        const current = await tx.asset.findUniqueOrThrow({ where: { id } });
        if (current.role === "DOCUMENT" && !permission(r.actor.role, "finance"))
          throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
        await tx.asset.update({
          where: { id },
          data: {
            archived: b.archived,
            ...(!b.archived ? { verified: false, rights: "INTERNAL" } : {}),
          },
        });
        await audit(
          tx,
          r.actor.id,
          b.archived ? "ASSET_ARCHIVED" : "ASSET_RESTORED",
          asset.itemId,
          { assetId: id, reason: b.reason },
        );
        await event(tx, asset.itemId, "RIGHTS_CHANGED");
        return { id };
      },
    );
  }
  @Access("edit") @Post("assets/:id/classify") async classify(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        role: z.enum([
          "PRODUCT",
          "DETAIL",
          "DEFECT",
          "REFERENCE",
          "DOCUMENT",
          "AI_MARKETING",
        ]),
        reason: safeText(1000).min(1),
      })
      .strict()
      .parse(raw);
    const first = await this.db.asset.findUniqueOrThrow({
      where: { id: uuid.parse(id) },
    });
    return this.commands.run(
      r.actor.id,
      "asset.classify",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        await itemLock(tx, first.itemId);
        const a = await tx.asset.findUniqueOrThrow({ where: { id } });
        if (
          (a.role === "DOCUMENT" || b.role === "DOCUMENT") &&
          !permission(r.actor.role, "finance")
        )
          throw new Fault("FORBIDDEN", "内部凭证需要财务权限", 403);
        if (
          ["AI", "REFERENCE"].includes(a.origin) &&
          !["REFERENCE", "AI_MARKETING"].includes(b.role)
        )
          throw new Fault(
            "INVALID_ORIGIN",
            "参考图或AI图不能改成实物交易图片",
            400,
          );
        if (a.role === b.role) return { id, unchanged: true };
        await tx.asset.update({
          where: { id },
          data: { role: b.role, verified: false, rights: "INTERNAL" },
        });
        await audit(tx, r.actor.id, "ASSET_CLASSIFIED", a.itemId, {
          assetId: id,
          from: a.role,
          to: b.role,
          reason: b.reason,
        });
        await event(tx, a.itemId, "RIGHTS_CHANGED");
        return { id };
      },
    );
  }
}
