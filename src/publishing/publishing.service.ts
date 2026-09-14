import { channelCopy } from "./channel-copy";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { Actor } from "../auth/auth";
import { Commands, Tx, audit, event, json } from "../common/transaction";
import { Fault } from "../common/errors";
import {
  assetUsable,
  factsSchema,
  requirements,
  safeText,
  titleWithCode,
  tm,
  uuid,
} from "../common/domain";
import { getItem, itemLock } from "../catalog/catalog.service";
export const purpose = z.enum(["TRADE", "SHOWROOM", "CUSTOMER_CARD"]);
export const packageSnapshot = z.object({
  code: z.string(),
  title: z.string(),
  body: z.string(),
  price: z.number().int().nullable(),
  currency: z.string(),
  locale: z.string(),
  purpose,
  assets: z.array(
    z.object({ id: uuid, sha256: z.string(), position: z.number() }),
  ),
  manualOverride: z.boolean(),
  waivers: z.array(uuid).default([]),
});
const packageInput = z
  .object({
    channelId: uuid,
    purpose: purpose.default("TRADE"),
    title: safeText(500).optional(),
    body: safeText(16000).optional(),
    confirmed: z.literal(true),
    draftId: uuid.optional(),
    draftVersion: z.number().int().positive().optional(),
    assetIds: z.array(uuid).min(1).max(40).optional(),
  })
  .strict();
export async function packageContext(
  tx: Tx,
  itemId: string,
  channelId: string,
  useApproved: boolean,
) {
  const item = await getItem(tx, itemId),
    channel = await tx.channel.findUnique({ where: { id: channelId } });
  if (!channel?.active)
    throw new Fault("CHANNEL_UNAVAILABLE", "渠道账号未启用", 400);
  const rev =
    useApproved && item.approvedId
      ? await tx.itemRevision.findUnique({ where: { id: item.approvedId } })
      : null;
  const approved = rev?.snapshot as
    | { title: string; brand: string; category: string; facts: unknown }
    | undefined;
  if (useApproved && (!item.approvedValid || !approved))
    throw new Fault("APPROVAL_REQUIRED", "请先批准有效商品资料");
  const facts = factsSchema.parse(approved?.facts ?? item.facts);
  const assets = (
    await tx.asset.findMany({
      where: { itemId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    })
  ).filter((a) => assetUsable(a));
  const validOffer = await tx.offer.findFirst({
    where: { itemId, status: "CONFIRMED", validUntil: { gt: new Date() } },
  });
  const waivers = await tx.requirementWaiver.findMany({
    where: { itemId, category: item.category, status: "ACTIVE" },
  });
  return { item, channel, rev, approved, facts, assets, validOffer, waivers };
}
@Injectable()
export class PublishingService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  async readiness(itemId: string, channelId: string, p = "TRADE") {
    return this.db.$transaction(async (tx) => {
      const c = await packageContext(tx, itemId, channelId, false);
      const draft = await tx.publishingDraft.findUnique({
        where: { itemId_channelId_purpose: { itemId, channelId, purpose: p } },
      });
      const sameBasis =
        draft &&
        c.item.approvedValid &&
        draft.basisRevisionId === c.item.approvedId &&
        draft.basisPrice === c.item.currentPrice &&
        draft.basisCurrency === c.item.currency;
      const missing = requirements({
        title: c.item.title,
        brand: c.item.brand,
        category: c.item.category,
        facts: {
          ...c.facts,
          ...(sameBasis
            ? c.channel.locale === "en"
              ? { descriptionEn: draft.body }
              : { descriptionZh: draft.body }
            : {}),
        },
        assetCount: c.assets.length,
        exemptions: c.waivers.map((w) => w.code),
        english: c.channel.locale === "en",
        trade: p !== "CUSTOMER_CARD",
        offerValid: !!c.validOffer,
        ownership: c.item.ownership,
        price: c.item.currentPrice,
        status: c.item.status,
      });
      return {
        missing,
        approved: c.item.approvedValid,
        ready: missing.length === 0 && c.item.approvedValid,
      };
    });
  }
  prepare(actor: Actor, itemId: string, key: unknown, raw: unknown) {
    const b = z
      .object({ channelId: uuid, purpose: purpose.default("TRADE") })
      .strict()
      .parse(raw);
    return this.commands.run(
      actor.id,
      "item.prepare",
      key,
      { itemId, ...b },
      async (tx) => {
        await itemLock(tx, itemId);
        const c = await packageContext(tx, itemId, b.channelId, false);
        const missing = requirements({
          title: c.item.title,
          brand: c.item.brand,
          category: c.item.category,
          facts: c.facts,
          assetCount: c.assets.length,
          exemptions: c.waivers.map((w) => w.code),
          english: c.channel.locale === "en",
          trade: b.purpose !== "CUSTOMER_CARD",
          offerValid: !!c.validOffer,
          ownership: c.item.ownership,
          price: c.item.currentPrice,
          status: c.item.status,
        });
        for (const m of missing) {
          await tx.task.upsert({
            where: { dedupeKey: `req:${itemId}:${m.code}` },
            create: {
              itemId,
              kind: "PREPARE",
              dedupeKey: `req:${itemId}:${m.code}`,
              title: m.title,
            },
            update: { status: "OPEN" },
          });
        }
        await audit(tx, actor.id, "PREPARATION_EVALUATED", itemId, {
          missing: missing.map((m) => m.code),
        });
        return { id: itemId, missing: missing.map((m) => m.code) };
      },
    );
  }
  async preview(itemId: string, channelId: string) {
    return this.db.$transaction(async (tx) => {
      const c = await packageContext(tx, itemId, channelId, true);
      return {
        ...channelCopy({
          code: tm(c.item.serial),
          title: c.approved!.title,
          brand: c.approved!.brand,
          facts: c.facts,
          platform: c.channel.platform,
          locale: c.channel.locale,
          titleLimit: c.channel.titleLimit,
        }),
        price: c.item.currentPrice,
        currency: c.item.currency,
      };
    });
  }
  create(actor: Actor, itemId: string, key: unknown, raw: unknown) {
    const b = packageInput.parse(raw);
    return this.commands.run(
      actor.id,
      "package.create",
      key,
      { itemId, ...b },
      async (tx) => {
        await itemLock(tx, itemId);
        const c = await packageContext(tx, itemId, b.channelId, true);
        const draft = b.draftId
          ? await tx.publishingDraft.findUnique({ where: { id: b.draftId } })
          : null;
        if (
          b.draftId &&
          (!draft ||
            draft.itemId !== itemId ||
            draft.channelId !== b.channelId ||
            draft.purpose !== b.purpose ||
            draft.version !== b.draftVersion)
        )
          throw new Fault("DRAFT_CONFLICT", "渠道草稿已变化，请重新读取后确认");
        if (
          draft &&
          (draft.basisRevisionId !== c.item.approvedId ||
            draft.basisPrice !== c.item.currentPrice ||
            draft.basisCurrency !== c.item.currency)
        )
          throw new Fault(
            "DRAFT_STALE",
            "商品资料或报价已变化，请比较最新资料后重新保存草稿",
          );
        if (
          draft &&
          (b.body !== undefined ||
            b.title !== undefined ||
            b.assetIds !== undefined)
        )
          throw new Fault(
            "DRAFT_OVERRIDE_DENIED",
            "使用草稿生成时不能绕过草稿另传文案或图片",
            400,
          );
        const missing = requirements({
          title: c.approved!.title,
          brand: c.approved!.brand,
          category: c.approved!.category,
          facts: {
            ...c.facts,
            ...(draft
              ? c.channel.locale === "en"
                ? { descriptionEn: draft.body }
                : { descriptionZh: draft.body }
              : {}),
          },
          assetCount: c.assets.length,
          exemptions: c.waivers.map((w) => w.code),
          english: c.channel.locale === "en",
          trade: b.purpose !== "CUSTOMER_CARD",
          offerValid: !!c.validOffer,
          ownership: c.item.ownership,
          price: c.item.currentPrice,
          status: c.item.status,
        });
        if (missing.length)
          throw new Fault(
            "NOT_READY",
            missing.map((m) => m.title).join("；"),
            400,
          );
        if (c.item.status !== "AVAILABLE")
          throw new Fault(
            "ITEM_NOT_AVAILABLE",
            "当前商品不可生成新的对外使用包",
          );
        const selectedIds = draft
          ? z.array(uuid).max(40).parse(draft.assetIds)
          : b.assetIds || c.assets.map((a) => a.id);
        if (
          !selectedIds.length ||
          selectedIds.length > 40 ||
          new Set(selectedIds).size !== selectedIds.length
        )
          throw new Fault(
            "IMAGE_SELECTION_REQUIRED",
            "请选择1至40张不重复的实物图片",
            400,
          );
        const selectedAssets = selectedIds.map((id) =>
          c.assets.find((a) => a.id === id),
        );
        if (selectedAssets.some((a) => !a))
          throw new Fault(
            "IMAGE_NOT_USABLE",
            "部分图片未复核、已归档或使用权过期",
            400,
          );
        if (
          c.assets.some(
            (a) => a.role === "DEFECT" && !selectedIds.includes(a.id),
          )
        )
          throw new Fault(
            "DEFECT_IMAGE_REQUIRED",
            "已核对的瑕疵图片必须保留，不能从发布资料中隐去",
            400,
          );
        const chosen = selectedAssets.filter(
          (a): a is NonNullable<typeof a> => !!a,
        );
        const code = tm(c.item.serial),
          template = channelCopy({
            code,
            title: c.approved!.title,
            brand: c.approved!.brand,
            facts: c.facts,
            platform: c.channel.platform,
            locale: c.channel.locale,
            titleLimit: c.channel.titleLimit,
          });
        let body = draft ? draft.body : (b.body ?? template.body);
        if (!body.trim())
          throw new Fault("COPY_REQUIRED", "发布内容不能为空", 400);
        // Do not allow marketing edits to silently hide the confirmed defect disclosure.
        if (c.facts.condition && !body.includes(c.facts.condition))
          body +=
            "\n\n" +
            (c.channel.locale === "en"
              ? "Condition / disclosed defects: "
              : "实际品相 / 瑕疵：") +
            c.facts.condition;
        const snap = {
          code,
          title: titleWithCode(
            draft?.title || b.title || c.approved!.title,
            code,
            c.channel.titleLimit,
          ),
          body,
          price: c.item.currentPrice,
          currency: c.item.currency,
          locale: c.channel.locale,
          purpose: b.purpose,
          assets: chosen.map((a, index) => ({
            id: a.id,
            sha256: a.sha256,
            position: index,
          })),
          manualOverride: !!draft || !!b.body || !!b.title,
          waivers: c.waivers.map((w) => w.id),
        };
        const expiries = [
          Date.now() + 7 * 86400000,
          ...chosen
            .filter((a) => a.validUntil)
            .map((a) => a.validUntil!.getTime()),
          ...(c.item.ownership === "SUPPLIER" && c.validOffer
            ? [c.validOffer.validUntil.getTime()]
            : []),
        ];
        const pack = await tx.usePackage.create({
          data: {
            itemId,
            channelId: b.channelId,
            revisionId: c.rev!.id,
            cycle: c.item.cycle,
            purpose: b.purpose,
            snapshot: json(snap),
            createdBy: actor.id,
            validUntil: new Date(Math.min(...expiries)),
          },
        });
        await audit(tx, actor.id, "PACKAGE_FROZEN", itemId, {
          packageId: pack.id,
          manualOverride: snap.manualOverride,
        });
        return { id: pack.id };
      },
    );
  }
  async validPackage(
    tx: Tx,
    id: string,
    allowHistorical = false,
    publicAccess = false,
  ) {
    const p = await tx.usePackage.findUnique({
      where: { id },
      include: { item: true, channel: true },
    });
    if (!p) throw new Fault("NOT_FOUND", "使用包不存在", 404);
    const s = packageSnapshot.parse(p.snapshot),
      i = p.item;
    if (publicAccess && i.dataMode === "TEST")
      throw new Fault("TEST_NOT_PUBLIC", "测试商品不对外展示", 404);
    if (i.deletedAt)
      throw new Fault("ITEM_DELETED", "商品已删除，发布资料停止使用");
    if (
      !allowHistorical &&
      (p.validUntil <= new Date() ||
        i.status !== "AVAILABLE" ||
        p.cycle !== i.cycle ||
        !i.approvedValid ||
        i.approvedId !== p.revisionId ||
        i.currentPrice !== s.price ||
        i.currency !== s.currency ||
        !p.channel.active)
    )
      throw new Fault(
        "PACKAGE_STALE",
        "使用包已过期、商品不可售或资料/报价已变化，请重新生成",
      );
    if (
      s.waivers.length &&
      (await tx.requirementWaiver.count({
        where: {
          id: { in: s.waivers },
          itemId: i.id,
          category: i.category,
          status: "ACTIVE",
        },
      })) !== s.waivers.length
    )
      throw new Fault("WAIVER_REVOKED", "尺寸不适用决定已失效，需重新复核");
    const assets = await tx.asset.findMany({
      where: { itemId: i.id, id: { in: s.assets.map((a) => a.id) } },
    });
    if (
      assets.length !== s.assets.length ||
      assets.some((a) => !assetUsable(a))
    )
      throw new Fault("RIGHTS_EXPIRED", "图片授权撤回、过期或未核验");
    if (
      !allowHistorical &&
      p.purpose !== "CUSTOMER_CARD" &&
      i.ownership === "SUPPLIER" &&
      !(await tx.offer.findFirst({
        where: {
          itemId: i.id,
          status: "CONFIRMED",
          validUntil: { gt: new Date() },
        },
      }))
    )
      throw new Fault("SUPPLY_EXPIRED", "供应商确认已过期");
    return { p, s, assets };
  }
  receipt(actor: Actor, key: unknown, raw: unknown) {
    const b = z
      .object({
        packageId: uuid,
        remoteId: safeText(300).min(1),
        url: z.union([z.string().url().max(2000), z.literal("")]).default(""),
      })
      .strict()
      .parse(raw);
    if (b.url && !/^https?:\/\//.test(b.url))
      throw new Fault("INVALID_URL", "仅允许HTTP/HTTPS链接", 400);
    return this.commands.run(
      actor.id,
      "listing.receipt",
      key,
      b,
      async (tx) => {
        const pack = await tx.usePackage.findUniqueOrThrow({
          where: { id: b.packageId },
        });
        await itemLock(tx, pack.itemId);
        const { p } = await this.validPackage(tx, b.packageId);
        const prior = await tx.listing.findUnique({
          where: {
            channelId_remoteId: {
              channelId: p.channelId,
              remoteId: b.remoteId,
            },
          },
        });
        if (p.purpose === "CUSTOMER_CARD")
          throw new Fault(
            "CARD_NOT_LISTING",
            "客户资料卡不能作为交易上架记录",
            400,
          );
        if (prior) {
          if (prior.itemId !== p.itemId)
            throw new Fault(
              "LISTING_ITEM_CONFLICT",
              "该远端记录属于另一件商品，禁止重新绑定",
            );
          if (prior.packageId === p.id && prior.desired === "LIVE")
            return { id: prior.id, existing: true };
          await audit(tx, actor.id, "LISTING_REPUBLISHED", p.itemId, {
            listingId: prior.id,
            previousPackageId: prior.packageId,
            newPackageId: p.id,
            previousDesired: prior.desired,
            previousObserved: prior.observed,
          });
          await tx.listing.update({
            where: { id: prior.id },
            data: {
              packageId: p.id,
              url: b.url,
              desired: "LIVE",
              observed:
                p.channel.platform === "SHOWROOM"
                  ? "SYSTEM_LIVE"
                  : "MANUAL_REPORTED_LIVE",
              observedAt: new Date(),
            },
          });
          await tx.task.updateMany({
            where: { listingId: prior.id, kind: "DELIST", status: "OPEN" },
            data: {
              status: "SATISFIED",
              note: "操作者确认按有效新使用包重新发布，旧下架任务由此回执替代",
            },
          });
          return { id: prior.id, updated: true };
        }
        const row = await tx.listing.create({
          data: {
            itemId: p.itemId,
            channelId: p.channelId,
            packageId: p.id,
            remoteId: b.remoteId,
            url: b.url,
            observed:
              p.channel.platform === "SHOWROOM"
                ? "SYSTEM_LIVE"
                : "MANUAL_REPORTED_LIVE",
          },
        });
        await audit(tx, actor.id, "LISTING_RECEIPT", p.itemId, {
          listingId: row.id,
          kind: row.observed,
        });
        return { id: row.id };
      },
    );
  }
  async observe(actor: Actor, id: string, key: unknown, raw: unknown) {
    const b = z
      .object({
        state: z.enum(["OFFLINE", "LIVE", "UNKNOWN"]),
        note: safeText(2000).min(1),
      })
      .strict()
      .parse(raw);
    const listing = await this.db.listing.findUniqueOrThrow({ where: { id } });
    return this.commands.run(
      actor.id,
      "listing.observe",
      key,
      { id, ...b },
      async (tx) => {
        await itemLock(tx, listing.itemId);
        await tx.listing.update({
          where: { id },
          data: {
            observed: "MANUAL_REPORTED_" + b.state,
            observedAt: new Date(),
          },
        });
        if (b.state === "OFFLINE")
          await tx.task.updateMany({
            where: { listingId: id, kind: "DELIST" },
            data: { status: "DONE", note: b.note },
          });
        if (b.state === "LIVE")
          await event(tx, listing.itemId, "CHECK_LISTINGS");
        await audit(tx, actor.id, "LISTING_OBSERVED", listing.itemId, {
          listingId: id,
          state: b.state,
        });
        return { id };
      },
    );
  }
}
