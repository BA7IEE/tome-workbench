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
export const channelBusinessPurpose = z.enum(["TRADE", "CONTENT", "SHOWROOM"]);

export function fixedChannelBusinessPurpose(platform: string) {
  if (platform === "XHS") return "CONTENT" as const;
  if (platform === "SHOWROOM") return "SHOWROOM" as const;
  return null;
}

export function resolveChannelBusinessPurpose(
  platform: string,
  requested?: z.infer<typeof channelBusinessPurpose>,
) {
  const fixed = fixedChannelBusinessPurpose(platform);
  if (fixed && requested && requested !== fixed)
    throw new Fault(
      "CHANNEL_PURPOSE_REQUIRED",
      `${platform === "XHS" ? "小红书" : "自有展厅"}只能作为${fixed === "CONTENT" ? "内容" : "展示"}渠道`,
      400,
    );
  return requested || fixed || "TRADE";
}

export function requireTradeChannel(
  channel: { businessPurpose: string },
  action = "交易分发",
) {
  if (channel.businessPurpose !== "TRADE")
    throw new Fault(
      "TRADE_CHANNEL_REQUIRED",
      `${action}只适用于交易用途的渠道账号`,
      400,
    );
}
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
  // Older snapshots had no basis and are interpreted as Item fallback only.
  // New snapshots retain the mutable ChannelPrice version they were reviewed
  // against, while the package itself remains immutable.
  priceBasis: z
    .object({
      source: z.enum(["ITEM", "CHANNEL"]),
      version: z.number().int().positive().nullable(),
    })
    .strict()
    .optional(),
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
const channelPriceInput = z
  .object({
    amount: z.number().int().min(0).max(2000000000).nullable(),
    currency: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.amount !== null &&
      !["CNY", "USD", "EUR", "HKD", "GBP", "SGD"].includes(value.currency || "")
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currency"],
        message: "设置渠道价时必须提供受支持的币种",
      });
  });

export type EffectiveChannelPrice = {
  amount: number | null;
  currency: string;
  source: "ITEM" | "CHANNEL";
  version: number | null;
};

export async function resolveChannelPrice(
  tx: Tx,
  item: { id: string; currentPrice: number | null; currency: string },
  channelId: string,
): Promise<EffectiveChannelPrice> {
  const stored = await tx.channelPrice.findUnique({
    where: { itemId_channelId: { itemId: item.id, channelId } },
  });
  const override = stored?.active ? stored : null;
  return override
    ? {
        amount: override.amount,
        currency: override.currency,
        source: "CHANNEL",
        version: override.version,
      }
    : {
        amount: item.currentPrice,
        currency: item.currency,
        source: "ITEM",
        version: null,
      };
}

export function fixedChannelCurrency(platform: string) {
  if (platform === "ANQICMS") return "USD";
  if (platform === "XIANYU") return "CNY";
  return null;
}

export function requiredChannelCurrency(channel: {
  platform: string;
  defaultCurrency: string;
}) {
  return fixedChannelCurrency(channel.platform) || channel.defaultCurrency;
}

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
  const price = await resolveChannelPrice(tx, item, channelId);
  return {
    item,
    channel,
    rev,
    approved,
    facts,
    assets,
    validOffer,
    waivers,
    price,
  };
}
@Injectable()
export class PublishingService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}
  async readiness(itemId: string, channelId: string, p = "TRADE") {
    return this.db.$transaction((tx) =>
      this.readinessInTransaction(tx, itemId, channelId, p),
    );
  }
  async readinessMany(itemIds: string[], channelId: string, p = "TRADE") {
    return this.db.$transaction(async (tx) => ({
      rows: await Promise.all(
        itemIds.map(async (itemId) => ({
          itemId,
          ...(await this.readinessInTransaction(tx, itemId, channelId, p)),
        })),
      ),
    }));
  }
  setChannelPrice(
    actor: Actor,
    itemId: string,
    channelId: string,
    key: unknown,
    raw: unknown,
  ) {
    const input = channelPriceInput.parse(raw);
    return this.commands.run(
      actor.id,
      "channel-price.set",
      key,
      { itemId, channelId, ...input },
      async (tx) => {
        const item = await itemLock(tx, itemId);
        const channel = await tx.channel.findUnique({
          where: { id: channelId },
        });
        if (!channel)
          throw new Fault("CHANNEL_NOT_FOUND", "所选渠道账号不存在", 400);
        requireTradeChannel(channel, "渠道报价");
        const expectedCurrency = requiredChannelCurrency(channel);
        if (input.amount !== null && input.currency !== expectedCurrency)
          throw new Fault(
            "CHANNEL_PRICE_CURRENCY_REQUIRED",
            `该渠道账号只能使用 ${expectedCurrency} 报价`,
            400,
          );
        const current = await tx.channelPrice.findUnique({
          where: { itemId_channelId: { itemId, channelId } },
        });
        if (input.amount === null) {
          const changed = current?.active
            ? await tx.channelPrice.update({
                where: { id: current.id },
                data: {
                  active: false,
                  updatedBy: actor.id,
                  version: { increment: 1 },
                },
              })
            : current;
          await audit(tx, actor.id, "CHANNEL_PRICE_FALLBACK", itemId, {
            channelId,
            source: "ITEM",
            version: changed?.version ?? null,
          });
        } else {
          const row = await tx.channelPrice.upsert({
            where: { itemId_channelId: { itemId, channelId } },
            create: {
              itemId,
              channelId,
              amount: input.amount,
              currency: input.currency!,
              updatedBy: actor.id,
              active: true,
            },
            update: {
              amount: input.amount,
              currency: input.currency!,
              updatedBy: actor.id,
              active: true,
              version: { increment: 1 },
            },
          });
          await audit(tx, actor.id, "CHANNEL_PRICE_SET", itemId, {
            channelId,
            amount: row.amount,
            currency: row.currency,
            version: row.version,
          });
        }
        const price = await resolveChannelPrice(tx, item, channelId);
        await event(tx, itemId, "CHANNEL_PRICE_CHANGED", {
          channelId,
          source: price.source,
          version: price.version,
        });
        return { itemId, channelId, price };
      },
    );
  }
  private async readinessInTransaction(
    tx: Tx,
    itemId: string,
    channelId: string,
    p: string,
  ) {
    const c = await packageContext(tx, itemId, channelId, false);
    if (p === "TRADE") requireTradeChannel(c.channel, "交易资料检查");
    const draft = await tx.publishingDraft.findUnique({
      where: { itemId_channelId_purpose: { itemId, channelId, purpose: p } },
    });
    const sameBasis =
      draft &&
      c.item.approvedValid &&
      draft.basisRevisionId === c.item.approvedId &&
      draft.basisPrice === c.price.amount &&
      draft.basisCurrency === c.price.currency &&
      draft.basisPriceSource === c.price.source &&
      draft.basisPriceVersion === c.price.version;
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
      price: c.price.amount,
      currency: c.price.currency,
      requiredCurrency: requiredChannelCurrency(c.channel),
      status: c.item.status,
    });
    return {
      missing,
      approved: c.item.approvedValid,
      ready: missing.length === 0 && c.item.approvedValid,
      price: c.price,
    };
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
        if (b.purpose === "TRADE")
          requireTradeChannel(c.channel, "交易资料检查");
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
          price: c.price.amount,
          currency: c.price.currency,
          requiredCurrency: requiredChannelCurrency(c.channel),
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
        price: c.price.amount,
        currency: c.price.currency,
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
        if (b.purpose === "TRADE") {
          const channel = await tx.channel.findUnique({
            where: { id: b.channelId },
          });
          if (channel) requireTradeChannel(channel, "交易资料交付");
        }
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
            draft.basisPrice !== c.price.amount ||
            draft.basisCurrency !== c.price.currency ||
            draft.basisPriceSource !== c.price.source ||
            draft.basisPriceVersion !== c.price.version)
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
          price: c.price.amount,
          currency: c.price.currency,
          requiredCurrency: requiredChannelCurrency(c.channel),
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
          price: c.price.amount,
          currency: c.price.currency,
          priceBasis: { source: c.price.source, version: c.price.version },
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
    const effectivePrice = await resolveChannelPrice(tx, i, p.channelId);
    const samePriceBasis = s.priceBasis
      ? s.priceBasis.source === effectivePrice.source &&
        s.priceBasis.version === effectivePrice.version
      : effectivePrice.source === "ITEM";
    if (
      !allowHistorical &&
      (p.validUntil <= new Date() ||
        i.status !== "AVAILABLE" ||
        p.cycle !== i.cycle ||
        !i.approvedValid ||
        i.approvedId !== p.revisionId ||
        effectivePrice.amount !== s.price ||
        effectivePrice.currency !== s.currency ||
        !samePriceBasis ||
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
