import { Injectable } from "@nestjs/common";
import { assetUsable, factsSchema, titleWithCode } from "../common/domain";
import { Fault } from "../common/errors";
import { audit, event, type Tx } from "../common/transaction";
import {
  packageSnapshot,
  requiredChannelCurrency,
  resolveChannelPrice,
} from "../publishing/publishing.service";

export type PublicationHealthState = "CURRENT" | "NEEDS_UPDATE" | "MUST_STOP";
export type PublicationHealthReason = { code: string; title: string };
export type PublicationHealth = {
  state: PublicationHealthState;
  reasons: PublicationHealthReason[];
};

export type PublicationExposure = {
  id: string;
  itemId: string;
  channelId: string;
  packageId: string | null;
  createdBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

type TimedAttempt = {
  id: string;
  sourceAttemptId?: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

const completedOfflineObservations = [
  "MANUAL_REPORTED_OFFLINE",
  "SYSTEM_OFFLINE",
  "VERIFIED_OFFLINE",
];

function occurredAt(row: Pick<TimedAttempt, "createdAt" | "finishedAt">) {
  return (row.finishedAt || row.createdAt).getTime();
}

function sourceStopped(source: TimedAttempt, stops: TimedAttempt[]) {
  const sourceAt = occurredAt(source);
  return stops.some(
    (stop) =>
      stop.sourceAttemptId === source.id ||
      (stop.sourceAttemptId === null && occurredAt(stop) > sourceAt),
  );
}

function sameAssetOrder(
  left: { id: string; position: number }[],
  right: { id: string; position: number }[],
) {
  if (left.length !== right.length) return false;
  return left.every(
    (entry, index) =>
      entry.id === right[index].id && entry.position === right[index].position,
  );
}

function withConditionDisclosure(
  body: string,
  condition: string,
  locale: string,
) {
  if (!condition || body.includes(condition)) return body;
  return (
    body +
    "\n\n" +
    (locale === "en"
      ? "Condition / disclosed defects: "
      : "实际品相 / 瑕疵：") +
    condition
  );
}

/**
 * The operational projection already has the Item × Channel facts in hand.
 * Keep the safety decision here pure so that projection can reuse exactly the
 * same rules without opening one transaction per successful publication.
 */
export type LoadedPublicationHealthInput = {
  now: Date;
  item: {
    id: string;
    deletedAt: Date | null;
    status: string;
    approvedValid: boolean;
    approvedId: string | null;
    facts: unknown;
    ownership: string;
    cycle: number;
  };
  channel: {
    active: boolean;
    businessPurpose: string;
    platform: string;
    defaultCurrency: string;
    locale: string;
    titleLimit: number;
  };
  target: { active: boolean } | null;
  packageRow: {
    revisionId: string;
    cycle: number;
    snapshot: unknown;
  } | null;
  price: {
    amount: number | null;
    currency: string;
    source: "ITEM" | "CHANNEL";
    version: number | null;
  };
  assets: {
    id: string;
    position: number;
    createdAt: Date;
    archived: boolean;
    rights: string;
    verified: boolean;
    validUntil: Date | null;
    origin: string;
    role: string;
  }[];
  validSupplierOffer: boolean;
  draft: {
    title: string;
    body: string;
    assetIds: unknown;
    basisRevisionId: string | null;
    basisPrice: number | null;
    basisCurrency: string;
    basisPriceSource: string;
    basisPriceVersion: number | null;
  } | null;
};

export function evaluateLoadedPublicationHealth(
  input: LoadedPublicationHealthInput,
): PublicationHealth {
  const { item, channel, target, packageRow, price, assets, draft, now } =
    input;
  const stop: PublicationHealthReason[] = [];
  const update: PublicationHealthReason[] = [];
  const addStop = (code: string, title: string) => stop.push({ code, title });
  const addUpdate = (code: string, title: string) =>
    update.push({ code, title });

  if (item.deletedAt) addStop("ITEM_DELETED", "商品已移入回收站");
  if (item.status !== "AVAILABLE")
    addStop("ITEM_NOT_AVAILABLE", "商品当前不可继续出售");
  if (target && !target.active)
    addStop("DISTRIBUTION_TARGET_CLOSED", "该渠道经营目标已关闭");
  if (!channel.active) addStop("CHANNEL_INACTIVE", "渠道账号已停用");
  if (channel.businessPurpose !== "TRADE")
    addStop("CHANNEL_NOT_TRADE", "渠道已不是交易用途");
  if (!item.approvedValid || !item.approvedId)
    addStop("APPROVAL_INVALID", "商品资料不再处于有效批准状态");
  const facts = factsSchema.safeParse(item.facts);
  if (
    !facts.success ||
    facts.data.authentication.status !== "PASSED" ||
    !facts.data.authentication.evidence
  )
    addStop("AUTHENTICATION_INVALID", "真实性复核或依据已失效");

  let snapshot: ReturnType<typeof packageSnapshot.parse> | null = null;
  if (!packageRow) {
    addStop("PUBLICATION_PACKAGE_MISSING", "发布资料缺少冻结使用包");
  } else {
    const parsed = packageSnapshot.safeParse(packageRow.snapshot);
    if (!parsed.success)
      addStop("PUBLICATION_PACKAGE_INVALID", "发布使用包无法安全复核");
    else snapshot = parsed.data;
  }

  const requiredCurrency = requiredChannelCurrency(channel);
  if (price.amount === null) addStop("TRADE_PRICE_MISSING", "交易报价缺失");
  else if (price.amount <= 0)
    addStop("TRADE_PRICE_NON_POSITIVE", "交易报价必须大于零");
  if (price.currency !== requiredCurrency)
    addStop(
      "TRADE_PRICE_CURRENCY_INVALID",
      `交易报价必须使用 ${requiredCurrency}`,
    );

  if (snapshot && packageRow) {
    if (snapshot.price === null || snapshot.price <= 0)
      addStop("PUBLICATION_PRICE_INVALID", "已发布资料的交易报价无效");
    if (snapshot.currency !== requiredCurrency)
      addStop(
        "PUBLICATION_PRICE_CURRENCY_INVALID",
        `已发布资料不是 ${requiredCurrency} 交易报价`,
      );

    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    for (const publishedAsset of snapshot.assets) {
      const asset = assetsById.get(publishedAsset.id);
      if (!asset) {
        addStop("PUBLICATION_ASSET_MISSING", "发布使用的图片已不存在");
        continue;
      }
      if (asset.archived)
        addStop("PUBLICATION_ASSET_ARCHIVED", "发布使用的图片已归档");
      if (asset.rights !== "PUBLIC")
        addStop(
          "PUBLICATION_ASSET_RIGHTS_INVALID",
          "发布图片不再具备公开使用权",
        );
      if (!asset.verified)
        addStop("PUBLICATION_ASSET_UNVERIFIED", "发布图片不再通过核验");
      if (asset.validUntil && asset.validUntil <= now)
        addStop("PUBLICATION_ASSET_RIGHTS_EXPIRED", "发布图片授权已过期");
      if (!assetUsable(asset, now))
        addStop("PUBLICATION_ASSET_INVALID", "发布图片不再是可用实物素材");
    }

    if (item.ownership === "SUPPLIER" && !input.validSupplierOffer)
      addStop("SUPPLIER_OFFER_EXPIRED", "供应商当前供货确认已失效");

    if (packageRow.cycle !== item.cycle)
      addStop("PUBLICATION_CYCLE_CHANGED", "商品经营周期已变化");

    const samePriceBasis = snapshot.priceBasis
      ? snapshot.priceBasis.source === price.source &&
        snapshot.priceBasis.version === price.version
      : price.source === "ITEM";
    if (
      snapshot.price !== price.amount ||
      snapshot.currency !== price.currency ||
      !samePriceBasis
    )
      addUpdate("CHANNEL_PRICE_CHANGED", "渠道报价或版本已变化");
    if (item.approvedId !== packageRow.revisionId)
      addUpdate("APPROVED_REVISION_CHANGED", "已批准商品版本已变化");

    const expectedAssets = snapshot.assets
      .slice()
      .sort(
        (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      )
      .map((asset) => ({ id: asset.id, position: asset.position }));
    if (draft) {
      const draftSameBasis =
        draft.basisRevisionId === item.approvedId &&
        draft.basisPrice === price.amount &&
        draft.basisCurrency === price.currency &&
        draft.basisPriceSource === price.source &&
        draft.basisPriceVersion === price.version;
      if (!draftSameBasis) {
        addUpdate(
          "CHANNEL_DRAFT_BASIS_CHANGED",
          "渠道草稿的资料或报价基础已变化",
        );
      } else {
        const selectedIds = Array.isArray(draft.assetIds)
          ? draft.assetIds.filter((id): id is string => typeof id === "string")
          : [];
        const draftAssets = selectedIds.map((id, position) => ({
          id,
          position,
        }));
        const expectedTitle = titleWithCode(
          draft.title || snapshot.title,
          snapshot.code,
          channel.titleLimit,
        );
        const expectedBody = withConditionDisclosure(
          draft.body,
          facts.success ? facts.data.condition : "",
          channel.locale,
        );
        if (
          snapshot.title !== expectedTitle ||
          snapshot.body !== expectedBody ||
          !sameAssetOrder(expectedAssets, draftAssets)
        )
          addUpdate("CHANNEL_DRAFT_CHANGED", "渠道文案或图片选择已变化");
      }
    } else {
      const currentAssets = assets
        .slice()
        .sort(
          (left, right) =>
            left.position - right.position ||
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .filter((asset) => assetUsable(asset, now))
        .map((asset, position) => ({ id: asset.id, position }));
      if (!sameAssetOrder(expectedAssets, currentAssets))
        addUpdate("PUBLICATION_IMAGES_CHANGED", "发布图片集合或顺序已变化");
    }
  }

  if (stop.length) return { state: "MUST_STOP", reasons: stop };
  if (update.length) return { state: "NEEDS_UPDATE", reasons: update };
  return { state: "CURRENT", reasons: [] };
}

/**
 * Stateless publication-safety rules.  Every read is explicitly supplied
 * through the caller's transaction so this service never owns a second
 * publication truth, a timer, or any external side effect.
 */
@Injectable()
export class PublicationHealthService {
  /**
   * Current exposure means the newest successful publish/update generation on
   * a channel without a later successful stop for that generation.  A stable
   * Listing is useful identity evidence, but is deliberately not required.
   */
  async currentPublicationExposures(
    tx: Tx,
    itemId: string,
    channelId?: string,
  ): Promise<PublicationExposure[]> {
    const [published, stops] = await Promise.all([
      tx.distributionAttempt.findMany({
        where: {
          itemId,
          ...(channelId ? { channelId } : {}),
          action: { in: ["PUBLISH", "UPDATE"] },
          state: "SUCCEEDED",
        },
        select: {
          id: true,
          itemId: true,
          channelId: true,
          packageId: true,
          createdBy: true,
          createdAt: true,
          finishedAt: true,
        },
        orderBy: [
          { finishedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
      tx.distributionAttempt.findMany({
        where: {
          itemId,
          ...(channelId ? { channelId } : {}),
          action: "DELIST",
          state: "SUCCEEDED",
        },
        select: {
          id: true,
          channelId: true,
          sourceAttemptId: true,
          createdAt: true,
          finishedAt: true,
        },
      }),
    ]);
    const latestByChannel = new Map<string, (typeof published)[number]>();
    for (const row of published)
      if (!latestByChannel.has(row.channelId))
        latestByChannel.set(row.channelId, row);
    return [...latestByChannel.values()].filter(
      (source) =>
        !sourceStopped(
          source,
          stops.filter((stop) => stop.channelId === source.channelId),
        ),
    );
  }

  /**
   * Re-evaluate an already successful external generation.  UsePackage's
   * seven-day handoff TTL is intentionally absent: it governs a new handoff,
   * not whether an acknowledged remote publication remains healthy.
   */
  async evaluatePublicationHealth(
    tx: Tx,
    itemId: string,
    channelId: string,
    sourceAttemptId: string,
  ): Promise<PublicationHealth> {
    const source = await tx.distributionAttempt.findUnique({
      where: { id: sourceAttemptId },
      include: {
        package: {
          select: {
            id: true,
            purpose: true,
            revisionId: true,
            cycle: true,
            snapshot: true,
            createdAt: true,
          },
        },
      },
    });
    if (
      !source ||
      source.itemId !== itemId ||
      source.channelId !== channelId ||
      !["PUBLISH", "UPDATE"].includes(source.action) ||
      source.state !== "SUCCEEDED"
    )
      throw new Fault(
        "PUBLICATION_SOURCE_REQUIRED",
        "需要已确认完成的发布资料代际",
        409,
      );

    const now = new Date();
    const [item, channel, target] = await Promise.all([
      tx.item.findUniqueOrThrow({ where: { id: itemId } }),
      tx.channel.findUniqueOrThrow({ where: { id: channelId } }),
      tx.distributionTarget.findUnique({
        where: { itemId_channelId: { itemId, channelId } },
      }),
    ]);
    const [price, assets, offer, draft] = await Promise.all([
      resolveChannelPrice(tx, item, channelId),
      tx.asset.findMany({
        where: { itemId },
        select: {
          id: true,
          position: true,
          createdAt: true,
          archived: true,
          rights: true,
          verified: true,
          validUntil: true,
          origin: true,
          role: true,
        },
      }),
      item.ownership === "SUPPLIER"
        ? tx.offer.findFirst({
            where: {
              itemId,
              status: "CONFIRMED",
              validUntil: { gt: now },
            },
            select: { id: true },
          })
        : null,
      tx.publishingDraft.findUnique({
        where: {
          itemId_channelId_purpose: {
            itemId,
            channelId,
            purpose: "TRADE",
          },
        },
        select: {
          title: true,
          body: true,
          assetIds: true,
          basisRevisionId: true,
          basisPrice: true,
          basisCurrency: true,
          basisPriceSource: true,
          basisPriceVersion: true,
        },
      }),
    ]);
    return evaluateLoadedPublicationHealth({
      now,
      item,
      channel,
      target,
      packageRow: source.package,
      price,
      assets,
      validSupplierOffer: !!offer,
      draft,
    });
  }

  async cancelPendingPublicationAttempts(
    tx: Tx,
    itemId: string,
    actorId: string,
    reason: string,
    channelId?: string,
  ) {
    const rows = await tx.distributionAttempt.findMany({
      where: {
        itemId,
        ...(channelId ? { channelId } : {}),
        action: { in: ["PUBLISH", "UPDATE"] },
        state: "PENDING",
      },
      select: { id: true, action: true, channelId: true },
    });
    for (const row of rows) {
      await tx.distributionAttempt.update({
        where: { id: row.id },
        data: {
          state: "CANCELLED",
          errorCode: "LOCAL_CANCELLED",
          errorMessage: reason,
          finishedAt: new Date(),
          leaseUntil: null,
        },
      });
      await audit(tx, actorId, "DISTRIBUTION_ATTEMPT_CANCELLED", itemId, {
        attemptId: row.id,
        action: row.action,
        channelId: row.channelId,
        reason,
      });
      await event(tx, itemId, "DISTRIBUTION_ATTEMPT_CANCELLED", {
        attemptId: row.id,
        channelId: row.channelId,
        reason,
      });
    }
    return rows.map((row) => row.id);
  }

  async distributionExposureBlockers(tx: Tx, itemId: string) {
    const [current, unsettled, listings] = await Promise.all([
      this.currentPublicationExposures(tx, itemId),
      tx.distributionAttempt.findMany({
        where: {
          itemId,
          OR: [
            {
              action: { in: ["PUBLISH", "UPDATE"] },
              state: { in: ["RUNNING", "UNKNOWN"] },
            },
            {
              action: "DELIST",
              state: { in: ["PENDING", "RUNNING", "UNKNOWN", "FAILED"] },
            },
          ],
        },
        select: {
          id: true,
          action: true,
          state: true,
          channel: { select: { id: true, name: true, platform: true } },
        },
      }),
      tx.listing.findMany({
        where: {
          itemId,
          OR: [
            { desired: { not: "OFFLINE" } },
            { observed: { notIn: completedOfflineObservations } },
          ],
        },
        select: {
          id: true,
          channel: { select: { id: true, name: true, platform: true } },
        },
      }),
    ]);
    const channelRows = await tx.channel.findMany({
      where: { id: { in: current.map((row) => row.channelId) } },
      select: { id: true, name: true, platform: true },
    });
    const channels = new Map(channelRows.map((row) => [row.id, row]));
    const blockers: {
      code: string;
      channelId: string;
      channelName: string;
      title: string;
    }[] = [];
    for (const source of current) {
      const channel = channels.get(source.channelId);
      blockers.push({
        code: "SUCCEEDED_PUBLICATION_EXPOSURE",
        channelId: source.channelId,
        channelName: channel?.name || source.channelId,
        title: `${channel?.name || "该渠道"}仍有已确认发布且未停售的远端暴露`,
      });
    }
    for (const row of unsettled)
      blockers.push({
        code:
          row.action === "DELIST"
            ? "UNRESOLVED_DELIST"
            : "UNRESOLVED_PUBLICATION_HANDOFF",
        channelId: row.channel.id,
        channelName: row.channel.name,
        title:
          row.action === "DELIST"
            ? `${row.channel.name}的停售交付尚未完成`
            : `${row.channel.name}的发布交付仍可能在线`,
      });
    for (const listing of listings)
      blockers.push({
        code: "ACTIVE_LISTING",
        channelId: listing.channel.id,
        channelName: listing.channel.name,
        title: `${listing.channel.name}仍有未确认离线的远端身份记录`,
      });
    return blockers;
  }
}
