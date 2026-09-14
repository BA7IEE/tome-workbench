import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthRequest } from "../auth/auth";
import { PrismaService } from "../database/prisma.service";
import { Commands, audit, json } from "../common/transaction";
import { amount, currency, safeText, tm, uuid } from "../common/domain";
import { itemLock, versionMatch } from "../catalog/catalog.service";
import { Fault } from "../common/errors";
import {
  packageContext,
  PublishingService,
  purpose,
} from "./publishing.service";
import { channelCopy } from "./channel-copy";
@Controller("api")
@Access("publish")
export class PublishingDraftsController {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private publishing: PublishingService,
  ) {}
  @Get("items/:id/publishing-space") async space(
    @Param("id") id: string,
    @Query("channelId") ch: string,
    @Query("purpose") use = "TRADE",
  ) {
    uuid.parse(id);
    uuid.parse(ch);
    purpose.parse(use);
    return this.db.$transaction(async (tx) => {
      const c = await packageContext(tx, id, ch, false),
        draft = await tx.publishingDraft.findUnique({
          where: {
            itemId_channelId_purpose: {
              itemId: id,
              channelId: ch,
              purpose: use,
            },
          },
        });
      const revision = c.item.approvedId
        ? await tx.itemRevision.findUnique({ where: { id: c.item.approvedId } })
        : null;
      const usable = c.item.approvedValid && revision;
      let suggested: null | ReturnType<typeof channelCopy> = null;
      if (usable) {
        const verified = await packageContext(tx, id, ch, true);
        suggested = channelCopy({
          code: tm(c.item.serial),
          title: verified.approved!.title,
          brand: verified.approved!.brand,
          facts: verified.facts,
          platform: c.channel.platform,
          locale: c.channel.locale,
          titleLimit: c.channel.titleLimit,
        });
      }
      const all = await tx.asset.findMany({
        where: {
          itemId: id,
          archived: false,
          role: { in: ["PRODUCT", "DETAIL", "DEFECT"] },
        },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      });
      return {
        item: {
          id,
          code: tm(c.item.serial),
          title: c.item.title,
          status: c.item.status,
          version: c.item.version,
          approvedId: c.item.approvedId,
          approvedValid: c.item.approvedValid,
          price: c.item.currentPrice,
          currency: c.item.currency,
        },
        channel: c.channel,
        draft,
        suggested,
        assets: all.map((a) => ({
          id: a.id,
          role: a.role,
          originalName: a.originalName,
          usable: c.assets.some((v) => v.id === a.id),
        })),
        outdated:
          !!draft &&
          (!usable ||
            draft.basisRevisionId !== c.item.approvedId ||
            draft.basisPrice !== c.item.currentPrice ||
            draft.basisCurrency !== c.item.currency),
      };
    });
  }
  @Post("items/:id/publishing-draft") save(
    @Param("id") id: string,
    @Body() raw: unknown,
    @Req() r: AuthRequest,
  ) {
    const b = z
      .object({
        channelId: uuid,
        purpose: purpose.default("TRADE"),
        version: z.number().int().min(0),
        title: safeText(500),
        body: safeText(16000),
        assetIds: z.array(uuid).max(40),
        basisRevisionId: uuid.nullable(),
        basisPrice: amount,
        basisCurrency: currency,
      })
      .strict()
      .parse(raw);
    if (new Set(b.assetIds).size !== b.assetIds.length)
      throw new Fault("DUPLICATE_IMAGE", "选择的图片不能重复", 400);
    return this.commands.run(
      r.actor.id,
      "publishing.draft.save",
      r.get("Idempotency-Key"),
      { id: uuid.parse(id), ...b },
      async (tx) => {
        await itemLock(tx, id);
        const channel = await tx.channel.findUnique({
          where: { id: b.channelId },
        });
        if (!channel?.active)
          throw new Fault("CHANNEL_UNAVAILABLE", "渠道尚未启用");
        const found = await tx.asset.count({
          where: {
            itemId: id,
            id: { in: b.assetIds },
            role: { in: ["PRODUCT", "DETAIL", "DEFECT"] },
          },
        });
        if (found !== b.assetIds.length)
          throw new Fault(
            "IMAGE_ITEM_MISMATCH",
            "图片不属于这件商品，或不是可选实拍",
            400,
          );
        const prior = await tx.publishingDraft.findUnique({
          where: {
            itemId_channelId_purpose: {
              itemId: id,
              channelId: b.channelId,
              purpose: b.purpose,
            },
          },
        });
        versionMatch(prior?.version || 0, b.version);
        const data = {
          itemId: id,
          channelId: b.channelId,
          purpose: b.purpose,
          title: b.title,
          body: b.body,
          assetIds: json(b.assetIds),
          basisRevisionId: b.basisRevisionId,
          basisPrice: b.basisPrice,
          basisCurrency: b.basisCurrency,
          updatedBy: r.actor.id,
        };
        const row = prior
          ? await tx.publishingDraft.update({
              where: { id: prior.id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.publishingDraft.create({ data });
        await audit(tx, r.actor.id, "CHANNEL_DRAFT_SAVED", id, {
          draftId: row.id,
          version: row.version,
        });
        return { id: row.id, version: row.version };
      },
    );
  }
  @Get("packages/:id/usable") async usable(@Param("id") id: string) {
    const result = await this.db.$transaction((tx) =>
      this.publishing.validPackage(tx, uuid.parse(id)),
    );
    return {
      id: result.p.id,
      channelId: result.p.channelId,
      purpose: result.p.purpose,
      snapshot: result.s,
      checkedAt: new Date(),
      validUntil: result.p.validUntil,
    };
  }
}
