import { ApiTags } from "@nestjs/swagger";
import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { Access, AuthRequest, permission } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit, event, hash, type Tx } from "../common/transaction";
import {
  assetUsable,
  expectedVersion,
  requirements,
  safeText,
  tm,
  uuid,
} from "../common/domain";
import { itemLock, versionMatch } from "../catalog/catalog.service";
import { approveRevision } from "../catalog/approve-revision";
import { Fault } from "../common/errors";
import {
  packageContext,
  purpose,
  requireTradeChannel,
  requiredChannelCurrency,
} from "./publishing.service";
import { channelCopy } from "./channel-copy";
async function reviewBasis(tx: Tx, id: string) {
  const item = await tx.item.findUniqueOrThrow({ where: { id } });
  const assets = await tx.asset.findMany({
    where: { itemId: id, role: { not: "DOCUMENT" } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const digest = hash({
    id,
    version: item.version,
    status: item.status,
    price: item.currentPrice,
    currency: item.currency,
    deletedAt: item.deletedAt,
    assets: assets.map((a) => ({
      id: a.id,
      sha256: a.sha256,
      role: a.role,
      origin: a.origin,
      rights: a.rights,
      verified: a.verified,
      validUntil: a.validUntil?.toISOString() || null,
      archived: a.archived,
      sourceNote: a.sourceNote,
      position: a.position,
    })),
  });
  return { item, assets, digest };
}
function blocked(a: Awaited<ReturnType<typeof reviewBasis>>["assets"][number]) {
  if (a.archived) return "已移入图片存档";
  if (
    !["PRODUCT", "DETAIL", "DEFECT"].includes(a.role) ||
    ["AI", "REFERENCE"].includes(a.origin)
  )
    return "参考或AI素材不能当作商品实拍";
  if (a.rights === "REVOKED") return "公开使用权已撤回，须先重新核对授权";
  if (a.validUntil && a.validUntil <= new Date())
    return "授权已过期，须先更新授权期限";
  return "";
}
@ApiTags("商品工作区")
@Controller("api/items")
export class StudioController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  @Access("publish") @Get(":id/studio") async studio(
    @Param("id") rawId: string,
    @Query() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = z
        .object({ channelId: uuid, purpose: purpose.default("TRADE") })
        .strict()
        .parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const c = await packageContext(tx, id, b.channelId, false),
          plan = await reviewBasis(tx, id),
          canReview = permission(r.actor.role, "review");
        if (b.purpose === "TRADE")
          requireTradeChannel(c.channel, "交易资料编辑");
        const draft = await tx.publishingDraft.findUnique({
          where: {
            itemId_channelId_purpose: {
              itemId: id,
              channelId: b.channelId,
              purpose: b.purpose,
            },
          },
        });
        const preview = channelCopy({
          code: tm(c.item.serial),
          title: c.item.title,
          brand: c.item.brand,
          facts: c.facts,
          platform: c.channel.platform,
          locale: c.channel.locale,
          titleLimit: c.channel.titleLimit,
        });
        const assets = plan.assets
          .filter((a) => !a.archived)
          .map((a) => ({
            id: a.id,
            originalName: a.originalName,
            role: a.role,
            origin: a.origin,
            usable: assetUsable(a),
            blockedReason: blocked(a),
            sourceNote: a.sourceNote,
          }));
        const missing = requirements({
          title: c.item.title,
          brand: c.item.brand,
          category: c.item.category,
          facts: {
            ...c.facts,
            descriptionZh: "editor",
            descriptionEn: "editor",
          },
          assetCount: assets.filter((a) =>
            canReview ? !a.blockedReason : a.usable,
          ).length,
          exemptions: c.waivers.map((w) => w.code),
          english: c.channel.locale === "en",
          trade: b.purpose !== "CUSTOMER_CARD",
          offerValid: !!c.validOffer,
          ownership: c.item.ownership,
          price: c.price.amount,
          currency: c.price.currency,
          requiredCurrency: requiredChannelCurrency(c.channel),
          status: c.item.status,
        });
        return {
          version: c.item.version,
          digest: plan.digest,
          approvedId: c.item.approvedId,
          approvedValid: c.item.approvedValid,
          price: c.price.amount,
          currency: c.price.currency,
          priceBasis: c.price,
          channel: c.channel,
          draft,
          preview,
          assets,
          missing,
          canReview,
          previewOnly: true,
          outdated:
            !!draft &&
            (draft.basisRevisionId !== c.item.approvedId ||
              draft.basisPrice !== c.price.amount ||
              draft.basisCurrency !== c.price.currency ||
              draft.basisPriceSource !== c.price.source ||
              draft.basisPriceVersion !== c.price.version ||
              !c.item.approvedValid),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  @Access("review") @Post(":id/review-for-use") review(
    @Param("id") rawId: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const id = uuid.parse(rawId),
      b = z
        .object({
          version: expectedVersion,
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          assetIds: z.array(uuid).min(1).max(40),
          authorizationNote: safeText(2000).min(3),
          confirmed: z.literal(true),
        })
        .strict()
        .parse(raw);
    if (new Set(b.assetIds).size !== b.assetIds.length)
      throw new Fault("DUPLICATE_IMAGE", "不能重复选择图片", 400);
    return this.commands.run(
      r.actor.id,
      "studio.review",
      r.get("Idempotency-Key"),
      { id, ...b },
      async (tx) => {
        const item = await itemLock(tx, id);
        versionMatch(item.version, b.version);
        const plan = await reviewBasis(tx, id);
        if (plan.digest !== b.digest)
          throw new Fault(
            "REVIEW_STALE",
            "商品或图片刚被修改，请在本页刷新核对，不会覆盖新内容",
          );
        const picked = b.assetIds.map((id) =>
          plan.assets.find((a) => a.id === id),
        );
        if (picked.some((a) => !a || blocked(a)))
          throw new Fault(
            "IMAGE_REVIEW_BLOCKED",
            "部分选图不可使用。请检查已撤权、过期、存档或非实拍的图片",
            400,
          );
        if (
          plan.assets.some(
            (a) =>
              a.role === "DEFECT" && !blocked(a) && !b.assetIds.includes(a.id),
          )
        )
          throw new Fault(
            "DEFECT_IMAGE_REQUIRED",
            "请保留全部已标记的瑕疵实拍",
            400,
          );
        for (const a of picked) {
          if (!a || assetUsable(a)) continue;
          await tx.asset.update({
            where: { id: a.id },
            data: {
              rights: "PUBLIC",
              verified: true,
              sourceNote: b.authorizationNote,
            },
          });
          await audit(tx, r.actor.id, "ASSET_REVIEWED", id, {
            assetId: a.id,
            rights: "PUBLIC",
            scope: "studio-explicit-review",
            authorizationNote: b.authorizationNote,
          });
        }
        const approved = await approveRevision(tx, item, r.actor.id);
        await audit(tx, r.actor.id, "STUDIO_REVIEW_CONFIRMED", id, {
          version: item.version,
          assetIds: b.assetIds,
          authorizationNote: b.authorizationNote,
        });
        await event(tx, id, "RIGHTS_CHANGED");
        return { ...approved, reviewedImages: b.assetIds.length };
      },
    );
  }
}
