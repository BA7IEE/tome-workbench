import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  Actor,
  digest,
  permission,
  type DistributionRequest,
  type Role,
} from "../auth/auth";
import { authorizationContext } from "../auth/request-context";
import { getItem, itemLock } from "../catalog/catalog.service";
import { config } from "../common/config";
import { Fault } from "../common/errors";
import {
  hash,
  json,
  lock,
  audit,
  event,
  Commands,
  type Tx,
} from "../common/transaction";
import {
  assetUsable,
  factsSchema,
  requirements,
  safeText,
  tm,
  uuid,
} from "../common/domain";
import { PrismaService } from "../database/prisma.service";
import { assetPath } from "../media/storage";
import {
  packageSnapshot,
  PublishingService,
  requireTradeChannel,
  requiredChannelCurrency,
} from "../publishing/publishing.service";
import {
  buildAnqicmsSpikePayload,
  buildAnqicmsTakedownProjection,
  validateAnqicmsArchiveId,
} from "./anqicms-spike";
import {
  DISTRIBUTION_PROTOCOL_VERSION,
  DISTRIBUTION_SKILL_ID,
  DISTRIBUTION_SKILL_NAME,
  DISTRIBUTION_SKILL_VERSION,
  GENERIC_STOP_PROFILE,
  profileForPlatform,
  readDistributionProfileDocument,
  readDistributionSkillDocument,
  type DistributionProfile,
} from "./distribution-standard";
import {
  evaluateLoadedPublicationHealth,
  PublicationHealthService,
  type PublicationHealth,
} from "./publication-health.service";

const terminalState = z.enum(["SUCCEEDED", "FAILED", "UNKNOWN"]);
const remoteUrl = z.union([z.literal(""), z.string().url().max(2000)]);
const evidence = z
  .object({
    method: z.enum([
      "TM_SEARCH",
      "API_RESPONSE",
      "PLATFORM_RECEIPT",
      "MANUAL_CONFIRMATION",
      "RECONCILIATION",
    ]),
    note: safeText(2000).min(1),
    locator: safeText(300).optional(),
  })
  .strict();
const resultInput = z
  .object({
    state: terminalState,
    remoteId: safeText(300).default(""),
    remoteUrl: remoteUrl.default(""),
    evidence: evidence.optional(),
    errorCode: safeText(120).default(""),
    errorMessage: safeText(2000).default(""),
  })
  .strict();
const sessionInput = z
  .object({
    channelId: uuid,
    label: safeText(120).min(1),
    agentName: safeText(120).default(""),
    expiresAt: z.string().datetime(),
  })
  .strict();
const planInput = z
  .object({
    packageId: uuid,
  })
  .strict();
const distributionTargetInput = z
  .object({
    active: z.boolean(),
    reason: safeText(2000).min(1),
    duplicatePlatformConfirmed: z.boolean().default(false),
  })
  .strict();
const listingReceiptInput = z
  .object({
    packageId: uuid,
    remoteId: safeText(300).min(1),
    url: remoteUrl.default(""),
  })
  .strict();
const handoffPublishedInput = z
  .object({
    note: safeText(2000).min(1),
    remoteId: safeText(300).default(""),
    remoteUrl: remoteUrl.default(""),
  })
  .strict();
const handoffAttentionInput = z
  .object({
    note: safeText(2000).min(1),
  })
  .strict();

const operationalState = z.enum([
  "READY",
  "BLOCKED",
  "PENDING",
  "HANDED_OFF",
  "PUBLISHED",
  "NEEDS_UPDATE",
  "ATTENTION",
  "NEEDS_STOP",
  "CANCELLED",
]);
const operationalScope = z.enum([
  "all",
  "unpublished",
  "ready",
  "blocked",
  "pending",
  "handed-off",
  "published",
  "needs-update",
  "attention",
  "needs-stop",
  "cancelled",
]);
const operationalInput = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(50),
    channelId: uuid.optional(),
    state: operationalState.optional(),
    scope: operationalScope.default("all"),
    q: safeText(200).default(""),
    brand: safeText(100).default(""),
    attemptId: uuid.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state && value.scope !== "all")
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "状态和范围筛选只能选择其中一个",
      });
  });

type OperationalState = z.infer<typeof operationalState>;
type OperationalAttempt = {
  id: string;
  action: string;
  state: string;
  sourceAttemptId: string | null;
  remoteId: string;
  remoteUrl: string;
  errorCode: string;
  errorMessage: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};
type OperationalAttemptWithPackage = OperationalAttempt & {
  packageId: string | null;
  leaseUntil: Date | null;
  claimedBySessionId: string | null;
  claimedBySession: {
    revokedAt: Date | null;
    expiresAt: Date;
  } | null;
};
type OperationalListing = {
  id: string;
  remoteId: string;
  url: string;
  desired: string;
  observed: string;
  observedAt: Date;
};
type OperationalRow = {
  id: string;
  state: OperationalState;
  priority: number;
  item: {
    id: string;
    serial: number;
    title: string;
    brand: string;
    status: string;
  };
  channel: { id: string; name: string; platform: string; active: boolean };
  attempt: OperationalAttempt | null;
  published: OperationalAttempt | null;
  listing: OperationalListing | null;
  missing: { code: string; title: string }[];
  health: PublicationHealth | null;
  updatedAt: Date;
};

const operationalPriority: Record<OperationalState, number> = {
  NEEDS_STOP: 100,
  ATTENTION: 95,
  BLOCKED: 80,
  NEEDS_UPDATE: 75,
  PENDING: 70,
  HANDED_OFF: 60,
  READY: 50,
  PUBLISHED: 40,
  CANCELLED: 10,
};

type AgentSession = DistributionRequest["distributionSession"];
type ResultInput = z.infer<typeof resultInput>;

/**
 * Compare the frozen business content rather than a UsePackage UUID. A new
 * package can legitimately have a new id while carrying exactly the same
 * handoff material, so its id and timestamps deliberately stay out of this
 * fingerprint.
 */
export function distributionPackageFingerprint(snapshot: unknown) {
  const value = packageSnapshot.parse(snapshot);
  return hash({
    title: value.title,
    body: value.body,
    price: value.price,
    currency: value.currency,
    purpose: value.purpose,
    assets: [...value.assets]
      .sort(
        (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      )
      .map((asset) => ({
        id: asset.id,
        sha256: asset.sha256,
        position: asset.position,
      })),
  });
}

function resultCode(error: unknown) {
  if (error instanceof Fault) {
    const data = error.getResponse() as { code?: unknown };
    if (typeof data.code === "string") return data.code;
  }
  return "PACKAGE_UNAVAILABLE";
}

function noCredentialText(value: string, field: string) {
  if (
    /(?:bearer\s+\S+|(?:token|password|secret|cookie|authorization|api[_-]?key|access[_-]?(?:token|key)|credential|session)\s*[:=]\s*\S+)/i.test(
      value,
    )
  )
    throw new Fault(
      "SENSITIVE_RESULT_DENIED",
      `${field}不得包含令牌、Cookie、密码或密钥`,
      400,
    );
}

function checkedUrl(value: string) {
  if (!value) return "";
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Fault("INVALID_URL", "仅允许HTTP/HTTPS链接", 400);
  if (parsed.username || parsed.password)
    throw new Fault("SENSITIVE_RESULT_DENIED", "链接不得包含登录信息", 400);
  if (
    [...parsed.searchParams.keys()].some((key) =>
      /(?:token|secret|signature|password|api[_-]?key|access[_-]?(?:token|key)|credential|cookie|session|auth)/i.test(
        key,
      ),
    ) ||
    /(?:^|[?&#;])(?:token|secret|signature|password|api[_-]?key|access[_-]?(?:token|key)|credential|cookie|session|auth)\s*=/i.test(
      parsed.hash,
    )
  )
    throw new Fault("SENSITIVE_RESULT_DENIED", "链接不得包含访问凭据", 400);
  return value;
}

function checkedResult(raw: unknown): ResultInput {
  const parsed = resultInput.parse(raw);
  if (/^MANUAL:/i.test(parsed.remoteId))
    throw new Fault(
      "FAKE_REMOTE_ID_DENIED",
      "不能用 MANUAL:TM 伪造远端身份；没有稳定ID时请留空",
      400,
    );
  noCredentialText(parsed.remoteId, "远端编号");
  noCredentialText(parsed.errorCode, "错误代码");
  noCredentialText(parsed.errorMessage, "错误说明");
  if (parsed.evidence) {
    noCredentialText(parsed.evidence.note, "执行依据");
    noCredentialText(parsed.evidence.locator || "", "核对定位信息");
  }
  checkedUrl(parsed.remoteUrl);
  if (parsed.state === "SUCCEEDED" && !parsed.remoteId && !parsed.evidence)
    throw new Fault(
      "SUCCESS_EVIDENCE_REQUIRED",
      "未取得稳定远端ID的成功结果必须说明如何通过永久TM复核",
      400,
    );
  if (
    ["FAILED", "UNKNOWN"].includes(parsed.state) &&
    (!parsed.errorCode || !parsed.errorMessage)
  )
    throw new Fault(
      "RESULT_REASON_REQUIRED",
      "失败或结果未知必须提供可读的原因代码与说明",
      400,
    );
  // A confirmed success must not retain an old UNKNOWN/FAILED explanation.
  // Keeping it would make the business record contradict its final state.
  return parsed.state === "SUCCEEDED"
    ? { ...parsed, errorCode: "", errorMessage: "" }
    : parsed;
}

function sameResult(
  attempt: {
    state: string;
    remoteId: string;
    remoteUrl: string;
    evidence: unknown;
    errorCode: string;
    errorMessage: string;
  },
  result: ResultInput,
) {
  return (
    attempt.state === result.state &&
    attempt.remoteId === result.remoteId &&
    attempt.remoteUrl === result.remoteUrl &&
    attempt.errorCode === result.errorCode &&
    attempt.errorMessage === result.errorMessage &&
    hash(attempt.evidence) === hash(result.evidence || {})
  );
}

// A successful APP publish can have no Listing because it has no stable remote
// identity. Stop safety must therefore look at handoff facts, not Listings.
// The caller already holds the item lock and runs inside the inventory command.
export async function planStopDistribution(
  tx: Tx,
  actorId: string | null,
  itemId: string,
  cycle: number | null,
  reason: string,
  channelId?: string,
) {
  const published = await tx.distributionAttempt.findMany({
    where: {
      itemId,
      ...(channelId ? { channelId } : {}),
      action: { in: ["PUBLISH", "UPDATE"] },
      state: "SUCCEEDED",
      ...(cycle === null ? {} : { package: { is: { cycle } } }),
    },
    select: { id: true, channelId: true, createdAt: true, finishedAt: true },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const latestByChannel = new Map<string, (typeof published)[number]>();
  for (const row of published)
    if (!latestByChannel.has(row.channelId))
      latestByChannel.set(row.channelId, row);
  const planned: string[] = [];
  for (const source of latestByChannel.values()) {
    const dedupeKey = `delist:${source.id}`;
    const current = await tx.distributionAttempt.findUnique({
      where: { dedupeKey },
    });
    if (current) continue;
    // A pre-migration record cannot be given a source link retroactively. It
    // remains the authoritative stop fact when it was created after this
    // generation completed, so a forward migration does not resend a stop.
    const legacy = await tx.distributionAttempt.findFirst({
      where: {
        itemId,
        channelId: source.channelId,
        action: "DELIST",
        sourceAttemptId: null,
        state: { in: ["PENDING", "RUNNING", "UNKNOWN", "FAILED", "SUCCEEDED"] },
        createdAt: { gte: source.finishedAt || source.createdAt },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (legacy) continue;
    const attempt = await tx.distributionAttempt.create({
      data: {
        itemId,
        channelId: source.channelId,
        action: "DELIST",
        dedupeKey,
        sourceAttemptId: source.id,
        createdBy: actorId,
      },
    });
    planned.push(attempt.id);
    await audit(tx, actorId || "SYSTEM", "DISTRIBUTION_ATTEMPT_PLANNED", itemId, {
      attemptId: attempt.id,
      action: attempt.action,
      channelId: attempt.channelId,
      sourceAttemptId: source.id,
      reason,
    });
    await event(tx, itemId, "DISTRIBUTION_ATTEMPT_PLANNED", {
      attemptId: attempt.id,
      action: attempt.action,
      channelId: attempt.channelId,
      sourceAttemptId: source.id,
      reason,
    });
  }
  return planned;
}

@Injectable()
export class DistributionService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
    private publishing: PublishingService,
    private publicationHealth: PublicationHealthService,
  ) {}

  async distributionTargets(itemId: string) {
    return this.db.$transaction(async (tx) => {
      await getItem(tx, itemId);
      return tx.distributionTarget.findMany({
        where: { itemId },
        select: {
          id: true,
          itemId: true,
          channelId: true,
          active: true,
          version: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          channel: {
            select: {
              id: true,
              name: true,
              platform: true,
              active: true,
              businessPurpose: true,
              locale: true,
              defaultCurrency: true,
            },
          },
        },
        orderBy: [{ channel: { createdAt: "asc" } }, { id: "asc" }],
      });
    });
  }

  setDistributionTarget(
    actor: Actor,
    itemId: string,
    channelId: string,
    key: unknown,
    raw: unknown,
  ) {
    const input = distributionTargetInput.parse(raw);
    return this.commands.run(
      actor.id,
      "distribution.target.set",
      key,
      { itemId, channelId, ...input },
      async (tx) => {
        await itemLock(tx, itemId);
        const channel = await tx.channel.findUnique({
          where: { id: channelId },
        });
        if (!channel)
          throw new Fault("CHANNEL_NOT_FOUND", "所选渠道账号不存在", 404);
        const existing = await tx.distributionTarget.findUnique({
          where: { itemId_channelId: { itemId, channelId } },
        });
        // A historical target may still need closing after a later channel
        // purpose change. New targets, however, are always TRADE-only.
        if (!existing) requireTradeChannel(channel, "分发经营目标");
        if (input.active) {
          if (!channel.active)
            throw new Fault(
              "CHANNEL_UNAVAILABLE",
              "渠道账号未启用，不能设为经营目标",
              400,
            );
          requireTradeChannel(channel, "分发经营目标");
          if (!existing?.active) {
            const [duplicates, exposures, legacyListing, outstandingHandoff] =
              await Promise.all([
              tx.distributionTarget.findMany({
                where: {
                  itemId,
                  active: true,
                  channelId: { not: channelId },
                  channel: { is: { platform: channel.platform } },
                },
                select: {
                  id: true,
                  channel: { select: { id: true, name: true, platform: true } },
                },
              }),
              this.publicationHealth.currentPublicationExposures(tx, itemId),
              tx.listing.findFirst({
                where: {
                  itemId,
                  channelId: { not: channelId },
                  desired: { not: "OFFLINE" },
                  channel: { is: { platform: channel.platform } },
                },
                select: { id: true, channelId: true },
              }),
              tx.distributionAttempt.findFirst({
                where: {
                  itemId,
                  channelId: { not: channelId },
                  action: { in: ["PUBLISH", "UPDATE"] },
                  state: { in: ["PENDING", "RUNNING", "UNKNOWN"] },
                  channel: { is: { platform: channel.platform } },
                },
                select: { id: true, channelId: true },
              }),
            ]);
            const exposureChannelIds = [
              ...new Set(
                exposures
                  .filter((row) => row.channelId !== channelId)
                  .map((row) => row.channelId),
              ),
            ];
            const exposureChannels = exposureChannelIds.length
              ? await tx.channel.findMany({
                  where: {
                    id: { in: exposureChannelIds },
                    platform: channel.platform,
                  },
                  select: { id: true },
                })
              : [];
            if (
              (
                duplicates.length ||
                exposureChannels.length ||
                legacyListing ||
                outstandingHandoff
              ) &&
              !input.duplicatePlatformConfirmed
            )
              throw new Fault(
                "DUPLICATE_PLATFORM_TARGET_CONFIRMATION_REQUIRED",
                `该商品在${channel.platform}已有经营目标或仍在线的历史暴露；请明确确认同平台多账号经营`,
                409,
              );
          }
        }
        const changed =
          !existing ||
          existing.active !== input.active ||
          existing.note !== input.reason;
        const target = existing
          ? changed
            ? await tx.distributionTarget.update({
                where: { id: existing.id },
                data: {
                  active: input.active,
                  note: input.reason,
                  updatedBy: actor.id,
                  version: { increment: 1 },
                },
              })
            : existing
          : await tx.distributionTarget.create({
              data: {
                itemId,
                channelId,
                active: input.active,
                note: input.reason,
                createdBy: actor.id,
                updatedBy: actor.id,
              },
            });
        const cancelledAttemptIds = !target.active
          ? await this.publicationHealth.cancelPendingPublicationAttempts(
              tx,
              itemId,
              actor.id,
              "经营目标已关闭，尚未交付的发布资料已在本地取消",
              channelId,
            )
          : [];
        const delistAttemptIds = !target.active
          ? await planStopDistribution(
              tx,
              actor.id,
              itemId,
              null,
              "DISTRIBUTION_TARGET_CLOSED",
              channelId,
            )
          : [];
        await audit(
          tx,
          actor.id,
          existing
            ? changed
              ? "DISTRIBUTION_TARGET_UPDATED"
              : "DISTRIBUTION_TARGET_RECONFIRMED"
            : "DISTRIBUTION_TARGET_CREATED",
          itemId,
          {
            targetId: target.id,
            channelId,
            active: target.active,
            version: target.version,
            reason: target.note,
            duplicatePlatformConfirmed: input.duplicatePlatformConfirmed,
            cancelledAttemptIds,
            delistAttemptIds,
          },
        );
        await event(tx, itemId, "DISTRIBUTION_TARGET_CHANGED", {
          targetId: target.id,
          channelId,
          active: target.active,
          version: target.version,
          cancelledAttemptIds,
          delistAttemptIds,
        });
        return {
          id: target.id,
          itemId: target.itemId,
          channelId: target.channelId,
          active: target.active,
          version: target.version,
          note: target.note,
          changed,
          cancelledAttemptIds,
          delistAttemptIds,
        };
      },
    );
  }

  private leaseSeconds() {
    const value = Number(process.env.DISTRIBUTION_LEASE_SECONDS || 120);
    const min = process.env.APP_ENV === "test" ? 1 : 30;
    if (!Number.isInteger(value) || value < min || value > 900)
      throw new Error("Invalid distribution lease duration");
    return value;
  }

  private standardHandoffAttention(
    attempt: OperationalAttemptWithPackage,
    now: Date,
    staleHours: number,
  ) {
    // Legacy claims retain a lease. A standard handoff deliberately has none:
    // it is only an external delivery fact and must never be auto-reclaimed.
    if (attempt.state !== "RUNNING" || attempt.leaseUntil !== null) return null;
    const session = attempt.claimedBySession;
    if (
      !attempt.claimedBySessionId ||
      !session ||
      session.revokedAt ||
      session.expiresAt <= now
    )
      return {
        code: "HANDOFF_SESSION_DEAD",
        message:
          "已交付资料绑定的分发会话已撤销、过期或不存在，需要人工按永久 TM 核对",
      };
    if (
      attempt.startedAt &&
      now.getTime() - attempt.startedAt.getTime() >= staleHours * 3600000
    )
      return {
        code: "HANDOFF_STALE",
        message: `标准交付已超过 ${staleHours} 小时，尚未收到结果；不会自动重发，请人工按永久 TM 核对`,
      };
    return null;
  }

  private async handoffScope(tx: Tx, channelId: string, action?: string) {
    const channel = await tx.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new Fault("CHANNEL_NOT_FOUND", "渠道账号不存在", 404);
    const stopOnly = !channel.active || channel.businessPurpose !== "TRADE";
    if (action && stopOnly && action !== "DELIST")
      throw new Fault(
        "STOP_ONLY_SESSION",
        "该渠道已停用或退出交易用途，只能处理未完成的停售交付",
        409,
      );
    return { channel, stopOnly };
  }

  private async credentialCommand<T extends Record<string, unknown>>(
    actor: Actor,
    operation: string,
    key: unknown,
    input: unknown,
    fn: (tx: Tx) => Promise<{ response: T; receipt: Record<string, unknown> }>,
  ) {
    if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{12,128}$/.test(key))
      throw new Fault("IDEMPOTENCY_REQUIRED", "写操作需要12—128位幂等键", 400);
    const requestHash = hash(input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `cmd:${actor.id}:${operation}:${key}`);
      const context = authorizationContext.getStore();
      if (
        !context?.action ||
        context.actorId !== actor.id ||
        !context.sessionId
      )
        throw new Fault("AUTH_CONTEXT_REQUIRED", "缺少受控写入上下文", 403);
      const users = await tx.$queryRaw<{ active: boolean; role: string }[]>`
        SELECT "active","role" FROM "User" WHERE "id"=${actor.id}::uuid FOR SHARE
      `;
      const account = users[0];
      const session = await tx.session.findUnique({
        where: { id: context.sessionId },
      });
      if (
        !account?.active ||
        !permission(account.role as Role, context.action) ||
        !session ||
        session.userId !== actor.id ||
        session.expiresAt <= new Date()
      )
        throw new Fault("ACCOUNT_REVOKED", "权限或会话已变化，请重新登录", 403);
      const prior = await tx.receipt.findUnique({
        where: { actorId_operation_key: { actorId: actor.id, operation, key } },
      });
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new Fault("IDEMPOTENCY_CONFLICT", "相同幂等键对应不同内容");
        throw new Fault(
          "TOKEN_ALREADY_ISSUED",
          "分发令牌仅在首次创建时显示。请撤销旧会话后创建新的会话。",
          409,
        );
      }
      const result = await fn(tx);
      await tx.receipt.create({
        data: {
          actorId: actor.id,
          operation,
          key,
          requestHash,
          response: json(result.receipt),
        },
      });
      return result.response;
    });
  }

  async createSession(actor: Actor, key: unknown, raw: unknown) {
    const input = sessionInput.parse(raw);
    noCredentialText(input.label, "会话标签");
    noCredentialText(input.agentName, "Agent 名称");
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt <= new Date())
      throw new Fault("SESSION_EXPIRY_INVALID", "分发会话必须在未来过期", 400);
    if (expiresAt.getTime() - Date.now() > 90 * 86400000)
      throw new Fault("SESSION_EXPIRY_INVALID", "分发会话最长90天", 400);
    const token = randomBytes(32).toString("hex");
    return this.credentialCommand(
      actor,
      "distribution.session.create",
      key,
      input,
      async (tx) => {
        const channel = await tx.channel.findUnique({
          where: { id: input.channelId },
        });
        if (!channel)
          throw new Fault("CHANNEL_NOT_FOUND", "渠道账号不存在", 404);
        const stopOnly = !channel.active || channel.businessPurpose !== "TRADE";
        if (stopOnly) {
          const unresolvedStops = await tx.distributionAttempt.count({
            where: {
              channelId: input.channelId,
              action: "DELIST",
              state: { notIn: ["SUCCEEDED", "CANCELLED"] },
            },
          });
          if (!unresolvedStops)
            throw new Fault(
              "CHANNEL_STOP_SESSION_UNAVAILABLE",
              "该渠道没有待处理的停售交付，不能创建新的分发会话",
              409,
            );
        }
        const session = await tx.distributionSession.create({
          data: {
            channelId: input.channelId,
            label: input.label,
            agentName: input.agentName,
            expiresAt,
            createdBy: actor.id,
            tokenHash: digest(token),
          },
        });
        await audit(tx, actor.id, "DISTRIBUTION_SESSION_CREATED", session.id, {
          channelId: session.channelId,
          label: session.label,
          expiresAt: session.expiresAt.toISOString(),
          stopOnly,
        });
        return {
          response: {
            id: session.id,
            channelId: session.channelId,
            expiresAt: session.expiresAt,
            token,
            stopOnly,
          },
          receipt: {
            id: session.id,
            channelId: session.channelId,
            expiresAt: session.expiresAt.toISOString(),
            tokenIssued: true,
            stopOnly,
          },
        };
      },
    );
  }

  async sessions(channelId?: string) {
    return this.db.distributionSession.findMany({
      where: channelId ? { channelId } : undefined,
      select: {
        id: true,
        channelId: true,
        label: true,
        agentName: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
        channel: { select: { id: true, name: true, platform: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  revokeSession(actor: Actor, key: unknown, id: string) {
    return this.commands.run(
      actor.id,
      "distribution.session.revoke",
      key,
      { id },
      async (tx) => {
        await lock(tx, `distribution-session:${id}`);
        const session = await tx.distributionSession.findUniqueOrThrow({
          where: { id },
        });
        if (!session.revokedAt)
          await tx.distributionSession.update({
            where: { id },
            data: { revokedAt: new Date() },
          });
        await audit(tx, actor.id, "DISTRIBUTION_SESSION_REVOKED", id, {
          channelId: session.channelId,
        });
        return { id, revoked: true };
      },
    );
  }

  private async planDecision(tx: Tx, packageId: string) {
    const { p, s } = await this.publishing.validPackage(tx, packageId);
    if (p.purpose === "CUSTOMER_CARD")
      throw new Fault("CARD_NOT_LISTING", "客户资料卡不能作为交易发布", 400);
    // Legacy packages may predate Channel.businessPurpose. They cannot be
    // used to create a fresh trade handoff after the account becomes CONTENT.
    if (p.purpose === "TRADE") requireTradeChannel(p.channel, "交易分发记录");

    // DistributionTarget is authoritative only for TRADE. Historical target
    // rows may survive a later channel-purpose change so history remains
    // interpretable; they must not block SHOWROOM handoffs.
    const target =
      p.purpose === "TRADE"
        ? await tx.distributionTarget.findUnique({
            where: {
              itemId_channelId: { itemId: p.itemId, channelId: p.channelId },
            },
          })
        : null;
    if (p.purpose === "TRADE" && !target)
      throw new Fault(
        "DISTRIBUTION_TARGET_REQUIRED",
        "新的交易发布或更新必须先明确此商品的渠道经营目标",
        409,
      );
    if (target && !target.active)
      throw new Fault(
        "DISTRIBUTION_TARGET_INACTIVE",
        "该商品已明确关闭此渠道经营目标；重新启用经营目标后才能生成新的发布或更新交付",
        409,
      );

    // A stop from an older external generation must be reconciled before a
    // newer PUBLISH/UPDATE can leave ToMe. Otherwise a late stop could take
    // down the newly published generation.
    const unresolvedStop = await tx.distributionAttempt.findFirst({
      where: {
        itemId: p.itemId,
        channelId: p.channelId,
        action: "DELIST",
        state: { in: ["PENDING", "RUNNING", "UNKNOWN", "FAILED"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (unresolvedStop)
      throw new Fault(
        "DELIST_RECONCILIATION_REQUIRED",
        "该渠道仍有未完成或待核对的停售记录；请先确认原停售结果，再重新发布",
        409,
      );

    // An outstanding handoff must be resolved before this account receives a
    // second external publish. It applies even when a newer package was made.
    const active = await tx.distributionAttempt.findFirst({
      where: {
        itemId: p.itemId,
        channelId: p.channelId,
        action: { in: ["PUBLISH", "UPDATE"] },
        state: { in: ["PENDING", "RUNNING", "UNKNOWN"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (active)
      return {
        p,
        existing: active,
        action: active.action,
        reason: "OUTSTANDING_HANDOFF" as const,
      };

    const published = await tx.distributionAttempt.findFirst({
      where: {
        itemId: p.itemId,
        channelId: p.channelId,
        action: { in: ["PUBLISH", "UPDATE"] },
        state: "SUCCEEDED",
      },
      include: { package: { select: { snapshot: true } } },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    const completedDelist = await tx.distributionAttempt.findFirst({
      where: {
        itemId: p.itemId,
        channelId: p.channelId,
        action: "DELIST",
        state: "SUCCEEDED",
        ...(published
          ? {
              OR: [
                { sourceAttemptId: published.id },
                // Pre-migration stop records had no source relation. Their
                // timestamp remains the only safe compatibility signal.
                { sourceAttemptId: null },
              ],
            }
          : {}),
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    const publishedAt = published?.finishedAt || published?.createdAt || null;
    // A source-linked stop is authoritative regardless of timestamp precision.
    // For an old row that predates this relation, retain the former chronology
    // check so history stays interpretable without rewriting it.
    const delistedAfterPublish =
      !!published &&
      !!completedDelist &&
      (completedDelist.sourceAttemptId === published.id ||
        (completedDelist.sourceAttemptId === null &&
          !!publishedAt &&
          (completedDelist.finishedAt || completedDelist.createdAt) >
            publishedAt));

    if (
      published?.package?.snapshot &&
      !delistedAfterPublish &&
      distributionPackageFingerprint(published.package.snapshot) ===
        distributionPackageFingerprint(s)
    )
      return {
        p,
        existing: published,
        action: "NOOP" as const,
        reason: "UNCHANGED_PACKAGE" as const,
      };

    const action = published && !delistedAfterPublish ? "UPDATE" : "PUBLISH";
    const baseDedupeKey = [
      action.toLowerCase(),
      p.itemId,
      p.channelId,
      p.id,
      ...(delistedAfterPublish && completedDelist
        ? ["after", completedDelist.id]
        : []),
    ].join(":");
    const exact = await tx.distributionAttempt.findUnique({
      where: { dedupeKey: baseDedupeKey },
    });
    if (exact && exact.state !== "CANCELLED")
      return {
        p,
        existing: exact,
        action: exact.action,
        reason: "SAME_PACKAGE" as const,
      };
    let dedupeKey = baseDedupeKey;
    if (exact?.state === "CANCELLED") {
      if (target?.active) {
        dedupeKey = `${baseDedupeKey}:target:${target.version}`;
        const resumed = await tx.distributionAttempt.findUnique({
          where: { dedupeKey },
        });
        if (resumed)
          return {
            p,
            existing: resumed,
            action: resumed.action,
            reason: "SAME_PACKAGE" as const,
          };
      } else {
        const prefix = `${baseDedupeKey}:after-cancel:`;
        const [liveLegacyRetry, cancelledRetries] = await Promise.all([
          tx.distributionAttempt.findFirst({
            where: {
              itemId: p.itemId,
              channelId: p.channelId,
              action,
              state: { not: "CANCELLED" },
              dedupeKey: { startsWith: prefix },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
          tx.distributionAttempt.count({
            where: {
              itemId: p.itemId,
              channelId: p.channelId,
              action,
              state: "CANCELLED",
              dedupeKey: { startsWith: prefix },
            },
          }),
        ]);
        if (liveLegacyRetry)
          return {
            p,
            existing: liveLegacyRetry,
            action: liveLegacyRetry.action,
            reason: "SAME_PACKAGE" as const,
          };
        dedupeKey = `${prefix}${cancelledRetries + 1}`;
      }
    }
    return {
      p,
      action,
      dedupeKey,
      fingerprint: distributionPackageFingerprint(s),
    };
  }

  plan(actor: Actor, key: unknown, raw: unknown) {
    const input = planInput.parse(raw);
    return this.commands.run(
      actor.id,
      "distribution.plan",
      key,
      input,
      async (tx) => {
        const packageRow = await tx.usePackage.findUnique({
          where: { id: input.packageId },
          select: { itemId: true },
        });
        if (!packageRow) throw new Fault("NOT_FOUND", "使用包不存在", 404);
        await itemLock(tx, packageRow.itemId);
        const decision = await this.planDecision(tx, input.packageId);
        if (decision.existing)
          return {
            id: decision.existing.id,
            state: decision.existing.state,
            action: decision.action,
            existing: true,
            ...(decision.reason === "UNCHANGED_PACKAGE" ? { noop: true } : {}),
          };
        const row = await tx.distributionAttempt.create({
          data: {
            itemId: decision.p.itemId,
            channelId: decision.p.channelId,
            packageId: decision.p.id,
            action: decision.action,
            dedupeKey: decision.dedupeKey,
            createdBy: actor.id,
          },
        });
        await audit(
          tx,
          actor.id,
          "DISTRIBUTION_ATTEMPT_PLANNED",
          decision.p.itemId,
          {
            attemptId: row.id,
            action: row.action,
            channelId: row.channelId,
            packageId: row.packageId,
            packageFingerprint: decision.fingerprint,
            automaticAction: true,
          },
        );
        await event(tx, decision.p.itemId, "DISTRIBUTION_ATTEMPT_PLANNED", {
          attemptId: row.id,
          channelId: row.channelId,
          action: row.action,
        });
        return {
          id: row.id,
          state: row.state,
          action: row.action,
          existing: false,
        };
      },
    );
  }

  async summary(channelId?: string) {
    const [grouped, pendingStops, channels] = await Promise.all([
      this.db.distributionAttempt.groupBy({
        by: ["channelId", "state"],
        where: channelId ? { channelId } : undefined,
        _count: { _all: true },
      }),
      this.db.distributionAttempt.groupBy({
        by: ["channelId"],
        where: {
          ...(channelId ? { channelId } : {}),
          action: "DELIST",
          state: { notIn: ["SUCCEEDED", "CANCELLED"] },
        },
        _count: { _all: true },
      }),
      this.db.channel.findMany({
        where: channelId ? { id: channelId } : undefined,
        select: { id: true, name: true, platform: true, active: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return channels.map((channel) => ({
      channel,
      counts: Object.fromEntries(
        grouped
          .filter((row) => row.channelId === channel.id)
          .map((row) => [row.state, row._count._all]),
      ),
      needsStop:
        pendingStops.find((row) => row.channelId === channel.id)?._count._all ||
        0,
    }));
  }

  /**
   * Read-only operating view.  It derives one current business state for an
   * Item × Channel pair from the existing Item, frozen package and handoff
   * facts; it deliberately does not persist a second inventory truth.
   */
  async operations(raw: unknown) {
    const input = operationalInput.parse(raw),
      now = new Date(),
      staleHours = config().distributionHandoffStaleHours;
    const pinned = input.attemptId
      ? await this.db.distributionAttempt.findUnique({
          where: { id: input.attemptId },
          select: { itemId: true, channelId: true },
        })
      : null;
    if (input.attemptId && !pinned)
      throw new Fault("NOT_FOUND", "分发记录不存在", 404);
    if (pinned && input.channelId && input.channelId !== pinned.channelId)
      throw new Fault("NOT_FOUND", "该分发记录不属于所选渠道", 404);

    const channels = await this.db.channel.findMany({
      where:
        input.channelId || pinned?.channelId
          ? { id: input.channelId || pinned?.channelId }
          : undefined,
      select: {
        id: true,
        name: true,
        platform: true,
        active: true,
        businessPurpose: true,
        locale: true,
        titleLimit: true,
        defaultCurrency: true,
      },
      orderBy: { createdAt: "asc" },
    });
    if (!channels.length)
      return {
        rows: [],
        total: 0,
        page: input.page,
        size: input.size,
        summary: { total: 0, states: {}, channels: [] },
      };

    const channelIds = channels.map((channel) => channel.id);
    // An operating pair exists only when there is an active TRADE intent or
    // an actual historical Attempt/Listing.  Do not manufacture Item × Channel
    // rows from inventory, packages, or inactive content channels.
    const scopedPair = {
      channelId: { in: channelIds },
      item: { deletedAt: null, dataMode: "BUSINESS" },
      ...(pinned ? { itemId: pinned.itemId, channelId: pinned.channelId } : {}),
    };
    const [activeTargets, historicalAttempts, historicalListings] =
      await Promise.all([
        this.db.distributionTarget.findMany({
          where: {
            ...scopedPair,
            active: true,
            channel: { businessPurpose: "TRADE", active: true },
          },
          select: { itemId: true, channelId: true },
          distinct: ["itemId", "channelId"],
        }),
        this.db.distributionAttempt.findMany({
          where: scopedPair,
          select: { itemId: true, channelId: true },
          distinct: ["itemId", "channelId"],
        }),
        this.db.listing.findMany({
          where: scopedPair,
          select: { itemId: true, channelId: true },
          distinct: ["itemId", "channelId"],
        }),
      ]);
    const pair = (itemId: string, channelId: string) =>
      `${itemId}:${channelId}`;
    const pairRows = new Map<string, { itemId: string; channelId: string }>();
    const activeTargetKeys = new Set<string>(),
      historyKeys = new Set<string>();
    for (const row of activeTargets) {
      const key = pair(row.itemId, row.channelId);
      activeTargetKeys.add(key);
      pairRows.set(key, row);
    }
    for (const row of [...historicalAttempts, ...historicalListings]) {
      const key = pair(row.itemId, row.channelId);
      historyKeys.add(key);
      pairRows.set(key, row);
    }
    const scopedPairs = [...pairRows.values()];
    if (!scopedPairs.length)
      return {
        rows: [],
        total: 0,
        page: input.page,
        size: input.size,
        summary: {
          total: 0,
          states: {},
          channels: channels.map((channel) => ({
            channel: {
              id: channel.id,
              name: channel.name,
              platform: channel.platform,
              active: channel.active,
            },
            counts: {},
          })),
        },
      };
    const pairWhere = {
      OR: scopedPairs.map(({ itemId, channelId }) => ({ itemId, channelId })),
    };
    const scopedItemIds = [...new Set(scopedPairs.map((row) => row.itemId))];
    const [
      items,
      attempts,
      packages,
      listings,
      channelPrices,
      targets,
      drafts,
    ] = await Promise.all([
      this.db.item.findMany({
        where: {
          id: { in: scopedItemIds },
          deletedAt: null,
          dataMode: "BUSINESS",
        },
        select: {
          id: true,
          deletedAt: true,
          serial: true,
          title: true,
          brand: true,
          category: true,
          status: true,
          approvedValid: true,
          approvedId: true,
          currentPrice: true,
          currency: true,
          ownership: true,
          cycle: true,
          facts: true,
          updatedAt: true,
          assets: {
            select: {
              id: true,
              position: true,
              createdAt: true,
              rights: true,
              verified: true,
              validUntil: true,
              role: true,
              origin: true,
              archived: true,
            },
          },
          offers: {
            where: { status: "CONFIRMED", validUntil: { gt: now } },
            select: { id: true },
          },
          waivers: {
            where: { status: "ACTIVE" },
            select: { id: true, code: true, category: true },
          },
        },
        orderBy: { serial: "asc" },
      }),
      this.db.distributionAttempt.findMany({
        where: pairWhere,
        select: {
          id: true,
          itemId: true,
          channelId: true,
          packageId: true,
          sourceAttemptId: true,
          action: true,
          state: true,
          remoteId: true,
          remoteUrl: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          leaseUntil: true,
          claimedBySessionId: true,
          claimedBySession: {
            select: { revokedAt: true, expiresAt: true },
          },
        },
      }),
      this.db.usePackage.findMany({
        where: pairWhere,
        select: {
          id: true,
          itemId: true,
          channelId: true,
          purpose: true,
          revisionId: true,
          cycle: true,
          snapshot: true,
          validUntil: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.db.listing.findMany({
        where: pairWhere,
        select: {
          id: true,
          itemId: true,
          channelId: true,
          remoteId: true,
          url: true,
          desired: true,
          observed: true,
          observedAt: true,
        },
      }),
      this.db.channelPrice.findMany({
        where: pairWhere,
        select: {
          itemId: true,
          channelId: true,
          amount: true,
          currency: true,
          active: true,
          version: true,
        },
      }),
      this.db.distributionTarget.findMany({
        where: pairWhere,
        select: { itemId: true, channelId: true, active: true },
      }),
      this.db.publishingDraft.findMany({
        where: { ...pairWhere, purpose: "TRADE" },
        select: {
          itemId: true,
          channelId: true,
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
    const needle = input.q.toLocaleLowerCase(),
      brandNeedle = input.brand.toLocaleLowerCase();
    const selectedItems = items.filter((item) => {
      if (pinned) return item.id === pinned.itemId;
      const tmCode = tm(item.serial).toLocaleLowerCase();
      return (
        (!brandNeedle ||
          item.brand.toLocaleLowerCase().includes(brandNeedle)) &&
        (!needle ||
          [item.title, item.brand, tmCode, String(item.serial)].some((value) =>
            value.toLocaleLowerCase().includes(needle),
          ))
      );
    });
    const itemIds = selectedItems.map((item) => item.id);
    if (!itemIds.length)
      return {
        rows: [],
        total: 0,
        page: input.page,
        size: input.size,
        summary: {
          total: 0,
          states: {},
          channels: channels.map((channel) => ({
            channel: {
              id: channel.id,
              name: channel.name,
              platform: channel.platform,
              active: channel.active,
            },
            counts: {},
          })),
        },
      };

    const attemptsByPair = new Map<string, OperationalAttemptWithPackage[]>();
    for (const row of attempts) {
      const key = pair(row.itemId, row.channelId);
      const rows = attemptsByPair.get(key) || [];
      rows.push({ ...row, packageId: row.packageId });
      attemptsByPair.set(key, rows);
    }
    const packagesByPair = new Map<string, (typeof packages)[number][]>(),
      packageById = new Map(packages.map((row) => [row.id, row]));
    for (const row of packages) {
      const key = pair(row.itemId, row.channelId);
      const rows = packagesByPair.get(key) || [];
      rows.push(row);
      packagesByPair.set(key, rows);
    }
    const listingsByPair = new Map<string, (typeof listings)[number][]>();
    for (const row of listings) {
      const key = pair(row.itemId, row.channelId);
      const rows = listingsByPair.get(key) || [];
      rows.push(row);
      listingsByPair.set(key, rows);
    }
    const channelById = new Map(
      channels.map((channel) => [channel.id, channel]),
    );
    const priceByPair = new Map(
      channelPrices.map((row) => [pair(row.itemId, row.channelId), row]),
    );
    const targetByPair = new Map(
      targets.map((row) => [pair(row.itemId, row.channelId), row]),
    );
    const draftByPair = new Map(
      drafts.map((row) => [pair(row.itemId, row.channelId), row]),
    );
    const channelsByItem = new Map<string, string[]>();
    for (const scopedPair of scopedPairs) {
      const rows = channelsByItem.get(scopedPair.itemId) || [];
      rows.push(scopedPair.channelId);
      channelsByItem.set(scopedPair.itemId, rows);
    }
    const toPublicAttempt = (
      row: OperationalAttemptWithPackage | null,
    ): OperationalAttempt | null =>
      row
        ? {
            id: row.id,
            action: row.action,
            state: row.state,
            sourceAttemptId: row.sourceAttemptId,
            remoteId: row.remoteId,
            remoteUrl: row.remoteUrl,
            errorCode: row.errorCode,
            errorMessage: row.errorMessage,
            createdAt: row.createdAt,
            startedAt: row.startedAt,
            finishedAt: row.finishedAt,
          }
        : null;
    const timeOf = (row: OperationalAttemptWithPackage) =>
      (row.finishedAt || row.createdAt).getTime();
    const newest = (rows: OperationalAttemptWithPackage[]) =>
      [...rows].sort(
        (left, right) =>
          timeOf(right) - timeOf(left) || right.id.localeCompare(left.id),
      )[0] || null;
    const newestListing = (rows: (typeof listings)[number][]) =>
      [...rows].sort(
        (left, right) =>
          right.observedAt.getTime() - left.observedAt.getTime() ||
          right.id.localeCompare(left.id),
      )[0] || null;
    const rows: OperationalRow[] = [];

    for (const item of selectedItems) {
      const facts = factsSchema.parse(item.facts);
      const usableAssets = new Map(
        item.assets
          .filter((asset) => assetUsable(asset))
          .map((asset) => [asset.id, asset]),
      );
      const activeWaivers = item.waivers.filter(
        (waiver) => waiver.category === item.category,
      );
      const activeWaiverIds = new Set(activeWaivers.map((waiver) => waiver.id));
      for (const channelId of channelsByItem.get(item.id) || []) {
        const channel = channelById.get(channelId);
        if (!channel) continue;
        const key = pair(item.id, channel.id),
          pairAttempts = attemptsByPair.get(key) || [],
          hasHistory = historyKeys.has(key),
          activeTarget = activeTargetKeys.has(key);
        // Operating rows begin with an explicit current TRADE target.  A real
        // historic Attempt/Listing remains visible even after that intent is
        // closed or the account changes purpose, because it can still need a
        // local stop record.  Packages alone are not an external exposure.
        if (
          !hasHistory &&
          !(activeTarget && channel.businessPurpose === "TRADE")
        )
          continue;

        const override = priceByPair.get(key);
        const price = override
          ? override.active
            ? {
                amount: override.amount,
                currency: override.currency,
                source: "CHANNEL" as const,
                version: override.version,
              }
            : {
                amount: item.currentPrice,
                currency: item.currency,
                source: "ITEM" as const,
                version: null,
              }
          : {
              amount: item.currentPrice,
              currency: item.currency,
              source: "ITEM" as const,
              version: null,
            };
        const draft = draftByPair.get(key) || null;
        const sameDraftBasis =
          !!draft &&
          item.approvedValid &&
          draft.basisRevisionId === item.approvedId &&
          draft.basisPrice === price.amount &&
          draft.basisCurrency === price.currency &&
          draft.basisPriceSource === price.source &&
          draft.basisPriceVersion === price.version;
        const currentFacts = {
          ...facts,
          ...(sameDraftBasis && draft
            ? channel.locale === "en"
              ? { descriptionEn: draft.body }
              : { descriptionZh: draft.body }
            : {}),
        };
        const missing = requirements({
          title: item.title,
          brand: item.brand,
          category: item.category,
          facts: currentFacts,
          assetCount: usableAssets.size,
          exemptions: activeWaivers.map((waiver) => waiver.code),
          english: channel.locale === "en",
          trade: true,
          offerValid: item.offers.length > 0,
          ownership: item.ownership,
          price: price.amount,
          currency: price.currency,
          requiredCurrency: requiredChannelCurrency(channel),
          status: item.status,
        });
        const ready =
          missing.length === 0 &&
          item.approvedValid &&
          channel.active &&
          channel.businessPurpose === "TRADE";
        const currentPackage = (candidate: (typeof packages)[number]) => {
          if (candidate.purpose !== "TRADE") return false;
          const snapshot = packageSnapshot.safeParse(candidate.snapshot);
          if (!snapshot.success) return false;
          const samePriceBasis = snapshot.data.priceBasis
            ? snapshot.data.priceBasis.source === price.source &&
              snapshot.data.priceBasis.version === price.version
            : price.source === "ITEM";
          return (
            item.status === "AVAILABLE" &&
            item.cycle === candidate.cycle &&
            item.approvedValid &&
            item.approvedId === candidate.revisionId &&
            price.amount === snapshot.data.price &&
            price.currency === snapshot.data.currency &&
            samePriceBasis &&
            snapshot.data.waivers.every((id) => activeWaiverIds.has(id)) &&
            snapshot.data.assets.every((asset) => usableAssets.has(asset.id)) &&
            (item.ownership !== "SUPPLIER" || item.offers.length > 0)
          );
        };
        const latestUsablePackage = (packagesByPair.get(key) || []).find(
          currentPackage,
        );
        const publications = pairAttempts.filter(
          (attempt) =>
            ["PUBLISH", "UPDATE"].includes(attempt.action) &&
            attempt.state === "SUCCEEDED",
        );
        const completedStops = pairAttempts.filter(
          (attempt) =>
            attempt.action === "DELIST" && attempt.state === "SUCCEEDED",
        );
        const currentPublication = newest(
          publications.filter((publication) => {
            const publicationAt = timeOf(publication);
            return !completedStops.some(
              (stop) =>
                stop.sourceAttemptId === publication.id ||
                (stop.sourceAttemptId === null && timeOf(stop) > publicationAt),
            );
          }),
        );
        const healthPackage = currentPublication?.packageId
          ? packageById.get(currentPublication.packageId) || null
          : null;
        const health = currentPublication
          ? evaluateLoadedPublicationHealth({
              now,
              item,
              channel,
              target: targetByPair.get(key) || null,
              packageRow: healthPackage,
              price,
              assets: item.assets,
              validSupplierOffer: item.offers.length > 0,
              draft,
            })
          : null;
        const openStop = newest(
          pairAttempts.filter(
            (attempt) =>
              attempt.action === "DELIST" &&
              !["SUCCEEDED", "CANCELLED"].includes(attempt.state),
          ),
        );
        const outstanding = newest(
          pairAttempts.filter(
            (attempt) =>
              ["PUBLISH", "UPDATE"].includes(attempt.action) &&
              ["PENDING", "RUNNING", "UNKNOWN", "FAILED"].includes(
                attempt.state,
              ),
          ),
        );
        const activeStandardHandoff = newest(
          pairAttempts.filter(
            (attempt) =>
              attempt.state === "RUNNING" && attempt.leaseUntil === null,
          ),
        );
        const handoffAttention = activeStandardHandoff
          ? this.standardHandoffAttention(
              activeStandardHandoff,
              now,
              staleHours,
            )
          : null;
        const publishedPackage =
          healthPackage?.purpose === "TRADE" ? healthPackage : null;
        let state: OperationalState | null = null,
          attempt: OperationalAttemptWithPackage | null = null;
        if (activeStandardHandoff && handoffAttention) {
          state = "ATTENTION";
          attempt = {
            ...activeStandardHandoff,
            errorCode: handoffAttention.code,
            errorMessage: handoffAttention.message,
          };
        } else if (openStop || health?.state === "MUST_STOP") {
          state = "NEEDS_STOP";
          attempt = openStop;
        } else if (outstanding) {
          attempt = outstanding;
          state =
            outstanding.state === "PENDING"
              ? "PENDING"
              : outstanding.state === "RUNNING"
                ? "HANDED_OFF"
                : "ATTENTION";
        } else if (currentPublication) {
          if (health?.state === "NEEDS_UPDATE") state = "NEEDS_UPDATE";
          else if (!ready) state = "BLOCKED";
          else if (
            !publishedPackage ||
            !currentPackage(publishedPackage) ||
            (latestUsablePackage &&
              distributionPackageFingerprint(latestUsablePackage.snapshot) !==
                distributionPackageFingerprint(publishedPackage.snapshot))
          )
            state = "NEEDS_UPDATE";
          else state = "PUBLISHED";
        } else if (item.status === "AVAILABLE") {
          state = ready ? "READY" : "BLOCKED";
        } else if (input.attemptId) {
          const cancelled = pairAttempts.find(
            (candidate) =>
              candidate.id === input.attemptId &&
              candidate.state === "CANCELLED",
          );
          if (cancelled) {
            state = "CANCELLED";
            attempt = cancelled;
          }
        }
        if (!state) continue;
        const visibleAttempt = toPublicAttempt(attempt),
          visiblePublished = toPublicAttempt(currentPublication),
          newestFact = newest(pairAttempts),
          listing = newestListing(listingsByPair.get(key) || []);
        rows.push({
          id: key,
          state,
          priority: operationalPriority[state],
          item: {
            id: item.id,
            serial: item.serial,
            title: item.title,
            brand: item.brand,
            status: item.status,
          },
          channel: {
            id: channel.id,
            name: channel.name,
            platform: channel.platform,
            active: channel.active,
          },
          attempt: visibleAttempt,
          published: visiblePublished,
          listing: listing
            ? {
                id: listing.id,
                remoteId: listing.remoteId,
                url: listing.url,
                desired: listing.desired,
                observed: listing.observed,
                observedAt: listing.observedAt,
              }
            : null,
          missing: missing.map((entry) => ({
            code: entry.code,
            title: entry.title,
          })),
          health,
          updatedAt:
            newestFact?.finishedAt ||
            newestFact?.createdAt ||
            listing?.observedAt ||
            latestUsablePackage?.createdAt ||
            item.updatedAt,
        });
      }
    }

    const states = rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.state] = (counts[row.state] || 0) + 1;
      return counts;
    }, {});
    const channelSummary = channels.map((channel) => ({
      channel: {
        id: channel.id,
        name: channel.name,
        platform: channel.platform,
        active: channel.active,
      },
      counts: rows
        .filter((row) => row.channel.id === channel.id)
        .reduce<Record<string, number>>((counts, row) => {
          counts[row.state] = (counts[row.state] || 0) + 1;
          return counts;
        }, {}),
    }));
    const inScope = (state: OperationalState) => {
      if (input.state) return state === input.state;
      if (input.scope === "all") return state !== "CANCELLED";
      if (input.scope === "unpublished")
        return ["READY", "BLOCKED", "PENDING", "HANDED_OFF"].includes(state);
      const scoped: Record<string, OperationalState> = {
        ready: "READY",
        blocked: "BLOCKED",
        pending: "PENDING",
        "handed-off": "HANDED_OFF",
        published: "PUBLISHED",
        "needs-update": "NEEDS_UPDATE",
        attention: "ATTENTION",
        "needs-stop": "NEEDS_STOP",
        cancelled: "CANCELLED",
      };
      return state === scoped[input.scope];
    };
    const filtered = rows
      .filter((row) => inScope(row.state))
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          left.item.serial - right.item.serial ||
          left.channel.name.localeCompare(right.channel.name),
      );
    // Keep a stale deep link usable after a filter removes the former last
    // page. This follows the catalog convention while still applying the
    // complete server-side filter and sort before taking the page slice.
    const page = Math.min(
      input.page,
      Math.max(1, Math.ceil(filtered.length / input.size)),
    );
    return {
      rows: filtered.slice((page - 1) * input.size, page * input.size),
      total: filtered.length,
      page,
      size: input.size,
      summary: { total: rows.length, states, channels: channelSummary },
    };
  }

  async operationalAttentionCount() {
    const result = await this.operations({ scope: "attention", size: 1 });
    return result.total;
  }

  async attempts(raw: unknown) {
    const input = z
      .object({
        channelId: uuid.optional(),
        itemId: uuid.optional(),
        state: z
          .enum([
            "PENDING",
            "RUNNING",
            "SUCCEEDED",
            "FAILED",
            "UNKNOWN",
            "CANCELLED",
          ])
          .optional(),
        take: z.coerce.number().int().min(1).max(200).default(100),
      })
      .strict()
      .parse(raw);
    return this.db.distributionAttempt.findMany({
      where: {
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.itemId ? { itemId: input.itemId } : {}),
        ...(input.state ? { state: input.state } : {}),
      },
      select: {
        id: true,
        itemId: true,
        channelId: true,
        packageId: true,
        sourceAttemptId: true,
        action: true,
        state: true,
        remoteId: true,
        remoteUrl: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        finishedAt: true,
        channel: { select: { id: true, name: true, platform: true } },
        item: { select: { id: true, serial: true, title: true, status: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: input.take,
    });
  }

  retry(actor: Actor, key: unknown, id: string) {
    return this.commands.run(
      actor.id,
      "distribution.attempt.retry",
      key,
      { id },
      async (tx) => {
        await lock(tx, `distribution-attempt:${id}`);
        const attempt = await tx.distributionAttempt.findUniqueOrThrow({
          where: { id },
        });
        await itemLock(tx, attempt.itemId);
        await this.handoffScope(tx, attempt.channelId, attempt.action);
        if (attempt.state === "UNKNOWN")
          throw new Fault(
            "RECONCILIATION_REQUIRED",
            "结果未知时必须先领取原执行记录并按永久TM核对，不能直接重试发布",
            409,
          );
        if (attempt.state !== "FAILED")
          throw new Fault(
            "RETRY_NOT_ALLOWED",
            "只有明确失败的执行记录可以重试",
            409,
          );
        const row = await tx.distributionAttempt.update({
          where: { id },
          data: {
            state: "PENDING",
            leaseUntil: null,
            errorCode: "",
            errorMessage: "",
            finishedAt: null,
          },
        });
        await audit(tx, actor.id, "DISTRIBUTION_ATTEMPT_RETRIED", row.itemId, {
          attemptId: row.id,
          priorState: attempt.state,
        });
        await event(tx, row.itemId, "DISTRIBUTION_ATTEMPT_RETRIED", {
          attemptId: row.id,
        });
        return { id: row.id, state: row.state };
      },
    );
  }

  private async upsertListing(
    tx: Tx,
    attempt: {
      itemId: string;
      channelId: string;
      packageId: string | null;
      action: string;
    },
    remoteId: string,
    url: string,
    actorId: string,
    observed: string,
  ) {
    if (!attempt.packageId)
      throw new Fault(
        "LISTING_PACKAGE_REQUIRED",
        "稳定远端身份必须关联发布使用包",
        409,
      );
    const live = await tx.listing.findMany({
      where: {
        itemId: attempt.itemId,
        channelId: attempt.channelId,
        desired: { not: "OFFLINE" },
      },
      select: { id: true, remoteId: true },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    });
    if (live.length > 1)
      throw new Fault(
        "REMOTE_IDENTITY_AMBIGUOUS",
        "该商品在此渠道存在多个未停售远端身份，请先人工核对并收敛后再继续发布",
        409,
      );
    if (live.length === 1 && live[0].remoteId !== remoteId)
      throw new Fault(
        attempt.action === "UPDATE"
          ? "UPDATE_REMOTE_ID_CONFLICT"
          : "LIVE_REMOTE_ID_CONFLICT",
        attempt.action === "UPDATE"
          ? "更新必须保持原远端身份；当前回传了不同的远端编号，请核对是否误建了第二个商品"
          : "该渠道已有未停售远端身份，不能用新的远端编号静默创建第二个在线商品",
        409,
      );
    const prior = await tx.listing.findUnique({
      where: { channelId_remoteId: { channelId: attempt.channelId, remoteId } },
    });
    if (prior) {
      if (prior.itemId !== attempt.itemId)
        throw new Fault(
          "REMOTE_ID_ITEM_CONFLICT",
          "该渠道远端身份已经关联另一件商品，不能静默覆盖",
          409,
        );
      if (prior.packageId !== attempt.packageId || prior.desired !== "LIVE")
        await audit(tx, actorId, "LISTING_REPUBLISHED", attempt.itemId, {
          listingId: prior.id,
          previousPackageId: prior.packageId,
          newPackageId: attempt.packageId,
          previousDesired: prior.desired,
          previousObserved: prior.observed,
        });
      const listing = await tx.listing.update({
        where: { id: prior.id },
        data: {
          packageId: attempt.packageId,
          url,
          desired: "LIVE",
          observed,
          observedAt: new Date(),
        },
      });
      if (prior.packageId !== attempt.packageId || prior.desired !== "LIVE")
        await tx.task.updateMany({
          where: { listingId: prior.id, kind: "DELIST", status: "OPEN" },
          data: {
            status: "SATISFIED",
            note: "操作者确认按有效新使用包重新发布，旧下架任务由此回执替代",
          },
        });
      return listing;
    }
    const listing = await tx.listing.create({
      data: {
        itemId: attempt.itemId,
        channelId: attempt.channelId,
        packageId: attempt.packageId,
        remoteId,
        url,
        observed,
      },
    });
    await audit(tx, actorId, "LISTING_RECEIPT", attempt.itemId, {
      listingId: listing.id,
      kind: observed,
    });
    return listing;
  }

  private async recordDelist(
    tx: Tx,
    attempt: { itemId: string; channelId: string },
    result: ResultInput,
    actorId: string,
    observed: string,
  ) {
    const offlineObserved =
      observed === "AGENT_REPORTED_LIVE"
        ? "AGENT_REPORTED_OFFLINE"
        : observed === "MANUAL_REPORTED_LIVE"
          ? "MANUAL_REPORTED_OFFLINE"
          : observed;
    let rows = await tx.listing.findMany({
      where: result.remoteId
        ? { channelId: attempt.channelId, remoteId: result.remoteId }
        : { itemId: attempt.itemId, channelId: attempt.channelId },
    });
    if (rows.some((row) => row.itemId !== attempt.itemId))
      throw new Fault(
        "REMOTE_ID_ITEM_CONFLICT",
        "该渠道远端身份已经关联另一件商品，不能将其登记为下架",
        409,
      );
    // A platform may disclose a stable ID only while deleting an old APP
    // listing. Preserve it when a historical publish package is available;
    // otherwise the Attempt remains the complete execution fact.
    if (!rows.length && result.remoteId) {
      const source = await tx.distributionAttempt.findFirst({
        where: {
          itemId: attempt.itemId,
          channelId: attempt.channelId,
          action: { in: ["PUBLISH", "UPDATE"] },
          state: "SUCCEEDED",
          packageId: { not: null },
        },
        orderBy: [
          { finishedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      });
      if (source?.packageId) {
        const created = await tx.listing.create({
          data: {
            itemId: attempt.itemId,
            channelId: attempt.channelId,
            packageId: source.packageId,
            remoteId: result.remoteId,
            url: result.remoteUrl,
            desired: "OFFLINE",
            observed: offlineObserved,
            observedAt: new Date(),
          },
        });
        rows = [created];
        await audit(
          tx,
          actorId,
          "LISTING_REMOTE_ID_RECONCILED",
          attempt.itemId,
          {
            listingId: created.id,
            channelId: attempt.channelId,
            sourceAttemptId: source.id,
          },
        );
      }
    }
    const updated = [];
    for (const row of rows) {
      updated.push(
        await tx.listing.update({
          where: { id: row.id },
          data: {
            desired: "OFFLINE",
            observed: offlineObserved,
            observedAt: new Date(),
            ...(result.remoteUrl ? { url: result.remoteUrl } : {}),
          },
        }),
      );
    }
    if (updated.length)
      await tx.task.updateMany({
        where: {
          listingId: { in: updated.map((row) => row.id) },
          kind: "DELIST",
          status: "OPEN",
        },
        data: {
          status: "DONE",
          note: "已由分发执行回执确认下架",
        },
      });
    return updated[0] || null;
  }

  private async enforceAnqicmsSuccessReceipt(
    tx: Tx,
    attempt: { channelId: string; action: string },
    result: ResultInput,
  ): Promise<ResultInput> {
    if (
      result.state !== "SUCCEEDED" ||
      !["PUBLISH", "UPDATE"].includes(attempt.action)
    )
      return result;
    const channel = await tx.channel.findUniqueOrThrow({
      where: { id: attempt.channelId },
      select: { platform: true },
    });
    if (channel.platform !== "ANQICMS") return result;
    if (!result.remoteId)
      throw new Fault(
        "ANQICMS_ARCHIVE_ID_REQUIRED",
        "AnQiCMS 发布或更新成功必须回传稳定 archive ID",
        400,
      );
    return { ...result, remoteId: validateAnqicmsArchiveId(result.remoteId) };
  }

  private async finish(
    tx: Tx,
    attempt: {
      id: string;
      itemId: string;
      channelId: string;
      packageId: string | null;
      action: string;
      attemptCount: number;
    },
    result: ResultInput,
    actorId: string,
    observed: string,
    incrementAttempt: boolean,
  ) {
    let finalResult = await this.enforceAnqicmsSuccessReceipt(
      tx,
      attempt,
      result,
    );
    const item = await itemLock(tx, attempt.itemId);
    if (
      finalResult.state === "SUCCEEDED" &&
      attempt.action === "UPDATE" &&
      !finalResult.remoteId
    ) {
      const live = await tx.listing.findMany({
        where: {
          itemId: attempt.itemId,
          channelId: attempt.channelId,
          desired: { not: "OFFLINE" },
        },
        select: { remoteId: true, url: true },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      });
      if (live.length > 1)
        throw new Fault(
          "REMOTE_IDENTITY_AMBIGUOUS",
          "该商品在此渠道存在多个未停售远端身份，请先人工核对并收敛后再继续更新",
          409,
        );
      if (live.length === 1)
        finalResult = {
          ...finalResult,
          remoteId: live[0].remoteId,
          remoteUrl: finalResult.remoteUrl || live[0].url,
        };
    }
    const listing =
      finalResult.state !== "SUCCEEDED"
        ? null
        : attempt.action === "DELIST"
          ? await this.recordDelist(tx, attempt, finalResult, actorId, observed)
          : finalResult.remoteId
            ? await this.upsertListing(
                tx,
                attempt,
                finalResult.remoteId,
                finalResult.remoteUrl,
                actorId,
                observed,
              )
            : null;
    const row = await tx.distributionAttempt.update({
      where: { id: attempt.id },
      data: {
        state: finalResult.state,
        remoteId: finalResult.remoteId,
        remoteUrl: finalResult.remoteUrl,
        evidence: json(finalResult.evidence || {}),
        errorCode: finalResult.errorCode,
        errorMessage: finalResult.errorMessage,
        ...(incrementAttempt ? { attemptCount: { increment: 1 } } : {}),
        leaseUntil: null,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    // An item can stop being saleable while an external handoff is still in
    // flight. A late successful PUBLISH/UPDATE must therefore create the same
    // source-linked stop fact as the inventory transition would have created.
    const health =
      finalResult.state === "SUCCEEDED" &&
      ["PUBLISH", "UPDATE"].includes(row.action)
        ? await this.publicationHealth.evaluatePublicationHealth(
            tx,
            row.itemId,
            row.channelId,
            row.id,
          )
        : null;
    const mustStop =
      item.status !== "AVAILABLE" || health?.state === "MUST_STOP";
    const delistAttemptIds =
      finalResult.state === "SUCCEEDED" &&
      ["PUBLISH", "UPDATE"].includes(row.action) &&
      mustStop
        ? await planStopDistribution(
            tx,
            actorId,
            row.itemId,
            null,
            item.status !== "AVAILABLE"
              ? `LATE_HANDOFF_AFTER_${item.status}`
              : `PUBLICATION_HEALTH:${health?.reasons.map((reason) => reason.code).join(",") || "MUST_STOP"}`,
            item.status !== "AVAILABLE" ? undefined : row.channelId,
          )
        : [];
    await audit(
      tx,
      actorId,
      `DISTRIBUTION_ATTEMPT_${finalResult.state}`,
      row.itemId,
      {
        attemptId: row.id,
        action: row.action,
        channelId: row.channelId,
        packageId: row.packageId,
        remoteId: row.remoteId || null,
        listingId: listing?.id || null,
        errorCode: row.errorCode || null,
        health,
        delistAttemptIds,
      },
    );
    await event(tx, row.itemId, "DISTRIBUTION_ATTEMPT_RESULT", {
      attemptId: row.id,
      state: row.state,
      channelId: row.channelId,
      listingId: listing?.id || null,
      health,
      delistAttemptIds,
    });
    return {
      id: row.id,
      state: row.state,
      listingId: listing?.id || null,
      delistAttemptIds,
    };
  }

  manualResult(actor: Actor, key: unknown, id: string, raw: unknown) {
    const result = checkedResult(raw);
    return this.commands.run(
      actor.id,
      "distribution.attempt.manual-result",
      key,
      { id, ...result },
      async (tx) => {
        await lock(tx, `distribution-attempt:${id}`);
        const attempt = await tx.distributionAttempt.findUniqueOrThrow({
          where: { id },
        });
        if (attempt.state === "UNKNOWN") {
          if (!["SUCCEEDED", "FAILED"].includes(result.state))
            throw new Fault(
              "RECONCILIATION_RESULT_REQUIRED",
              "结果未知只能在原分发记录上核对为已确认完成或需要处理",
              409,
            );
          if (!result.evidence)
            throw new Fault(
              "RECONCILIATION_EVIDENCE_REQUIRED",
              "结果未知的人工核对必须填写核对依据",
              400,
            );
          const finished = await this.finish(
            tx,
            attempt,
            result,
            actor.id,
            "MANUAL_RECONCILIATION",
            false,
          );
          await audit(tx, actor.id, "DISTRIBUTION_RECONCILED", attempt.itemId, {
            attemptId: attempt.id,
            priorState: "UNKNOWN",
            state: finished.state,
            evidence: result.evidence,
          });
          return { ...finished, reconciled: true };
        }
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.state)) {
          if (sameResult(attempt, result))
            return { id: attempt.id, state: attempt.state, existing: true };
          throw new Fault(
            "ATTEMPT_RESULT_CONFLICT",
            "该执行记录已有不同结果",
            409,
          );
        }
        if (
          attempt.state === "RUNNING" &&
          attempt.claimedBySessionId &&
          attempt.leaseUntil &&
          attempt.leaseUntil > new Date()
        )
          throw new Fault(
            "ATTEMPT_LEASED",
            "该执行记录正在由受限 Agent 执行；请等待租约到期或由该 Agent 回传结果",
            409,
          );
        return this.finish(
          tx,
          attempt,
          result,
          actor.id,
          "MANUAL_REPORTED_LIVE",
          attempt.state === "PENDING",
        );
      },
    );
  }

  listingReceipt(actor: Actor, key: unknown, raw: unknown) {
    const input = listingReceiptInput.parse(raw);
    if (/^MANUAL:/i.test(input.remoteId))
      throw new Fault(
        "FAKE_REMOTE_ID_DENIED",
        "不能用 MANUAL:TM 伪造远端身份；没有稳定ID时请更新分发记录结果",
        400,
      );
    noCredentialText(input.remoteId, "远端编号");
    checkedUrl(input.url);
    return this.commands.run(
      actor.id,
      "listing.receipt",
      key,
      input,
      async (tx) => {
        const packageRow = await tx.usePackage.findUnique({
          where: { id: input.packageId },
          select: { itemId: true },
        });
        if (!packageRow) throw new Fault("NOT_FOUND", "使用包不存在", 404);
        await itemLock(tx, packageRow.itemId);
        const decision = await this.planDecision(tx, input.packageId);
        if (
          decision.existing &&
          decision.reason === "OUTSTANDING_HANDOFF" &&
          decision.existing.packageId !== decision.p.id
        )
          throw new Fault(
            "HANDOFF_RESOLUTION_REQUIRED",
            "该渠道已有待核对或待交付的原分发记录；请先在原记录登记结果，不能用新使用包绕过",
            409,
          );
        const p = decision.p;
        const attempt =
          decision.existing ||
          (await tx.distributionAttempt.create({
            data: {
              itemId: p.itemId,
              channelId: p.channelId,
              packageId: p.id,
              action: decision.action,
              dedupeKey: decision.dedupeKey,
              createdBy: actor.id,
            },
          }));
        const result = checkedResult({
          state: "SUCCEEDED",
          remoteId: input.remoteId,
          remoteUrl: input.url,
          evidence: {
            method: "MANUAL_CONFIRMATION",
            note: "操作者已取得稳定远端身份并登记发布结果",
          },
        });
        const priorListing = await tx.listing.findUnique({
          where: {
            channelId_remoteId: {
              channelId: p.channelId,
              remoteId: input.remoteId,
            },
          },
        });
        if (attempt.state === "SUCCEEDED") {
          if (attempt.remoteId === input.remoteId) {
            const listing = await tx.listing.findUnique({
              where: {
                channelId_remoteId: {
                  channelId: attempt.channelId,
                  remoteId: input.remoteId,
                },
              },
            });
            if (!listing)
              throw new Fault(
                "LISTING_MISSING",
                "成功执行记录缺少稳定远端身份对应的 Listing",
                409,
              );
            return { id: listing.id, attemptId: attempt.id, existing: true };
          }
          throw new Fault(
            "ATTEMPT_RESULT_CONFLICT",
            "该使用包已有不同的成功远端身份",
            409,
          );
        }
        if (attempt.state === "CANCELLED")
          throw new Fault(
            "ATTEMPT_CANCELLED",
            "已取消的执行记录不能登记结果",
            409,
          );
        const finished = await this.finish(
          tx,
          attempt,
          result,
          actor.id,
          p.channel.platform === "SHOWROOM"
            ? "SYSTEM_LIVE"
            : "MANUAL_REPORTED_LIVE",
          attempt.state === "PENDING",
        );
        if (!finished.listingId)
          throw new Fault("LISTING_MISSING", "稳定远端身份未生成 Listing", 409);
        return {
          id: finished.listingId,
          attemptId: finished.id,
          state: finished.state,
          ...(priorListing &&
          (priorListing.packageId !== p.id || priorListing.desired !== "LIVE")
            ? { updated: true }
            : {}),
        };
      },
    );
  }

  /**
   * The standard handoff surface has the same receipt and revocation
   * guarantees as machine ingest, without turning an external executor into
   * a ToMe runtime worker.  In particular, a receipt replay checks the live
   * DistributionSession and the creator's current publish right before it is
   * returned.
   */
  private async machineHandoffRun<T extends Record<string, unknown>>(
    session: AgentSession,
    operation: string,
    key: unknown,
    input: unknown,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{12,128}$/.test(key))
      throw new Fault(
        "IDEMPOTENCY_REQUIRED",
        "标准分发交付写操作需要12—128位幂等键",
        400,
      );
    const receiptOperation = `machine.distribution.${session.id}.${operation}`;
    const requestHash = hash(input);
    return this.db.$transaction(
      async (tx) => {
        await lock(
          tx,
          `machine-distribution:${session.id}:${operation}:${key}`,
        );
        await lock(tx, `distribution-session:${session.id}`);
        const live = await tx.distributionSession.findUnique({
          where: { id: session.id },
        });
        if (
          !live ||
          live.revokedAt ||
          live.expiresAt <= new Date() ||
          live.createdBy !== session.createdBy ||
          live.channelId !== session.channelId
        )
          throw new Fault(
            "DISTRIBUTION_SESSION_EXPIRED",
            "分发会话不存在、已撤销或已过期",
            401,
          );
        const users = await tx.$queryRaw<{ active: boolean; role: string }[]>`
          SELECT "active","role" FROM "User" WHERE "id"=${session.createdBy}::uuid FOR SHARE
        `;
        const account = users[0];
        if (!account?.active || !permission(account.role as Role, "publish"))
          throw new Fault(
            "DISTRIBUTION_CREATOR_REVOKED",
            "分发会话创建者已失去发布权限",
            403,
          );
        const prior = await tx.receipt.findUnique({
          where: {
            actorId_operation_key: {
              actorId: session.createdBy,
              operation: receiptOperation,
              key,
            },
          },
        });
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw new Fault(
              "IDEMPOTENCY_CONFLICT",
              "相同幂等键对应不同标准分发交付内容",
              409,
            );
          return prior.response as T;
        }
        const result = await fn(tx);
        await tx.distributionSession.update({
          where: { id: session.id },
          data: { lastUsedAt: new Date() },
        });
        await tx.receipt.create({
          data: {
            actorId: session.createdBy,
            operation: receiptOperation,
            key,
            requestHash,
            response: json(result),
          },
        });
        return result;
      },
      { maxWait: 10000, timeout: 30000 },
    );
  }

  async handoffs(session: AgentSession) {
    const channel = await this.db.channel.findUnique({
      where: { id: session.channelId },
      select: { active: true, businessPurpose: true },
    });
    if (!channel) throw new Fault("CHANNEL_NOT_FOUND", "渠道账号不存在", 404);
    const stopOnly = !channel.active || channel.businessPurpose !== "TRADE";
    const rows = await this.db.distributionAttempt.findMany({
      where: {
        channelId: session.channelId,
        ...(stopOnly ? { action: "DELIST" } : {}),
        OR: [
          { state: "PENDING" },
          { state: "RUNNING", claimedBySessionId: session.id },
        ],
      },
      select: {
        id: true,
        action: true,
        state: true,
        item: { select: { serial: true } },
        channel: { select: { id: true, name: true, platform: true } },
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    return rows.map((row) => ({
      recordId: row.id,
      action: row.action,
      status: row.state,
      tm: tm(row.item.serial),
      channel: row.channel,
    }));
  }

  private async anqicmsHandoffPayload(
    tx: Tx,
    attempt: {
      id: string;
      itemId: string;
      channelId: string;
      packageId: string | null;
      action: string;
    },
    assetRoute: "handoffs" | "attempts" = "handoffs",
  ) {
    const channel = await tx.channel.findUniqueOrThrow({
      where: { id: attempt.channelId },
    });
    if (channel.platform !== "ANQICMS")
      throw new Fault(
        "ANQICMS_CHANNEL_REQUIRED",
        "只有 AnQiCMS API 渠道可以读取本地资料合同",
        409,
      );

    if (attempt.action === "DELIST") {
      const item = await tx.item.findUniqueOrThrow({
        where: { id: attempt.itemId },
        select: { id: true, serial: true, status: true },
      });
      const listing = await tx.listing.findFirst({
        where: { itemId: item.id, channelId: attempt.channelId },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        select: { remoteId: true, url: true },
      });
      return buildAnqicmsTakedownProjection({
        action: "DELIST",
        item: { tmCode: tm(item.serial), status: item.status },
        listing: listing
          ? { archiveId: listing.remoteId, url: listing.url }
          : null,
      });
    }

    if (!attempt.packageId)
      throw new Fault(
        "ANQICMS_PACKAGE_REQUIRED",
        "AnQiCMS 发布资料需要有效冻结使用包，不能凭空拼装资料",
        409,
      );
    const pack = await this.publishing.validPackage(tx, attempt.packageId);
    if (pack.s.price === null || pack.s.currency !== "USD")
      throw new Fault(
        "ANQICMS_USD_REQUIRED",
        "AnQiCMS 发布合同只接受已冻结的 USD 渠道报价",
        409,
      );
    const revision = await tx.itemRevision.findUnique({
      where: { id: pack.p.revisionId },
    });
    const approved = revision?.snapshot as
      | {
          brand?: string;
          category?: string;
          facts?: unknown;
        }
      | undefined;
    if (!approved?.brand || !approved.category || !approved.facts)
      throw new Fault(
        "ANQICMS_APPROVED_FACTS_REQUIRED",
        "AnQiCMS 合同需要冻结版本中的品牌、分类和已批准商品事实",
        409,
      );
    const facts = factsSchema.parse(approved.facts);
    const conditionSelection = await tx.itemDictionarySelection.findUnique({
      where: {
        itemId_kind: { itemId: pack.p.itemId, kind: "CONDITION" },
      },
      select: { code: true },
    });
    const attribute = (key: string) => {
      const value = facts.attributes[key];
      return typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
        ? String(value)
        : "";
    };
    const byId = new Map(pack.assets.map((asset) => [asset.id, asset]));
    const images = pack.s.assets.map((image) => {
      const asset = byId.get(image.id);
      if (!asset)
        throw new Fault(
          "ANQICMS_IMAGE_REQUIRED",
          "使用包缺少已批准图片，不能生成 AnQiCMS 合同资料",
          409,
        );
      if (!["PRODUCT", "DETAIL", "DEFECT"].includes(asset.role))
        throw new Fault(
          "ANQICMS_IMAGE_ROLE_INVALID",
          "AnQiCMS 合同只能使用已批准的实物、细节或瑕疵图片",
          409,
        );
      return {
        id: image.id,
        role: asset.role as "PRODUCT" | "DETAIL" | "DEFECT",
        position: image.position,
        download: `/api/distribution-agent/${assetRoute}/${attempt.id}/assets/${image.id}`,
      };
    });
    const listing = await tx.listing.findFirst({
      where: { itemId: attempt.itemId, channelId: attempt.channelId },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    });
    return buildAnqicmsSpikePayload({
      action: attempt.action as "PUBLISH" | "UPDATE" | "DELIST",
      item: {
        tmCode: pack.s.code,
        title: pack.s.title,
        body: pack.s.body,
        price: pack.s.price,
        currency: "USD",
        status: pack.p.item.status,
        brand: approved.brand,
        category: approved.category,
        conditionGrade: conditionSelection?.code || "",
        conditionDescription: facts.condition,
        size: facts.sizeLabel || attribute("size"),
        color: facts.color || attribute("color"),
        material: facts.mainMaterial || facts.material || attribute("material"),
        measurements: facts.measurements,
        year: attribute("year"),
        collection: attribute("collection"),
        styleNumber: attribute("styleNumber") || attribute("style_number"),
      },
      images,
      listing: listing
        ? { archiveId: listing.remoteId, url: listing.url }
        : null,
    });
  }

  private async platformDataForHandoff(
    tx: Tx,
    attempt: {
      id: string;
      itemId: string;
      channelId: string;
      packageId: string | null;
      action: string;
    },
  ) {
    const channel = await tx.channel.findUniqueOrThrow({
      where: { id: attempt.channelId },
      select: { platform: true },
    });
    if (channel.platform !== "ANQICMS") return null;
    return {
      schema: "tome.anqicms/v1",
      payload: await this.anqicmsHandoffPayload(tx, attempt),
    };
  }

  private async handoffPackagePayload(
    tx: Tx,
    attempt: {
      id: string;
      itemId: string;
      channelId: string;
      packageId: string | null;
      action: string;
    },
  ) {
    await this.handoffScope(tx, attempt.channelId, attempt.action);
    if (!attempt.packageId) {
      const [item, channel] = await Promise.all([
        tx.item.findUniqueOrThrow({ where: { id: attempt.itemId } }),
        tx.channel.findUniqueOrThrow({ where: { id: attempt.channelId } }),
      ]);
      // A stop handoff deliberately carries only durable identity.  It must
      // not reconstruct a stale publishing package or make old image rights
      // a prerequisite for stopping sale.
      return {
        recordId: attempt.id,
        action: attempt.action,
        tm: tm(item.serial),
        channel: {
          id: channel.id,
          name: channel.name,
          platform: channel.platform,
        },
        package: null,
        platformData: await this.platformDataForHandoff(tx, attempt),
      };
    }
    const pack = await this.publishing.validPackage(tx, attempt.packageId);
    const assets = new Map(pack.assets.map((asset) => [asset.id, asset]));
    return {
      recordId: attempt.id,
      action: attempt.action,
      tm: pack.s.code,
      channel: {
        id: pack.p.channel.id,
        name: pack.p.channel.name,
        platform: pack.p.channel.platform,
      },
      package: {
        title: pack.s.title,
        body: pack.s.body,
        price: pack.s.price,
        currency: pack.s.currency,
        images: [...pack.s.assets]
          .sort(
            (left, right) =>
              left.position - right.position || left.id.localeCompare(right.id),
          )
          .map((image) => ({
            id: image.id,
            role: assets.get(image.id)?.role || "PRODUCT",
            position: image.position,
            sha256: image.sha256,
            download: `/api/distribution-agent/handoffs/${attempt.id}/assets/${image.id}`,
          })),
      },
      platformData: await this.platformDataForHandoff(tx, attempt),
    };
  }

  async handoffPackage(session: AgentSession, key: unknown, id: string) {
    return this.machineHandoffRun(
      session,
      "handoff.package",
      key,
      { recordId: id },
      async (tx) => {
        await lock(tx, `distribution-attempt:${id}`);
        const attempt = await tx.distributionAttempt.findFirst({
          where: { id, channelId: session.channelId },
        });
        if (!attempt) throw new Fault("NOT_FOUND", "分发交付记录不存在", 404);
        await this.handoffScope(tx, attempt.channelId, attempt.action);
        if (attempt.state === "UNKNOWN")
          throw new Fault(
            "RECONCILIATION_REQUIRED",
            "需要核对的记录只能由人工在原记录完成核对，不能再次交付",
            409,
          );
        if (
          attempt.state === "RUNNING" &&
          attempt.claimedBySessionId !== session.id
        )
          throw new Fault("HANDOFF_OWNED", "该分发资料已交给另一受限会话", 409);
        if (!["PENDING", "RUNNING"].includes(attempt.state))
          throw new Fault(
            "HANDOFF_NOT_AVAILABLE",
            "当前分发记录不能交付资料",
            409,
          );
        if (attempt.state === "RUNNING")
          return this.handoffPackagePayload(tx, attempt);

        await itemLock(tx, attempt.itemId);
        if (attempt.packageId) {
          try {
            await this.publishing.validPackage(tx, attempt.packageId);
          } catch (error) {
            const errorCode = resultCode(error);
            const errorMessage =
              error instanceof Error ? error.message : "使用包不可用";
            const failed = await tx.distributionAttempt.update({
              where: { id: attempt.id },
              data: {
                state: "FAILED",
                errorCode,
                errorMessage,
                leaseUntil: null,
                finishedAt: new Date(),
              },
            });
            await audit(
              tx,
              session.createdBy,
              "DISTRIBUTION_HANDOFF_FAILED",
              failed.itemId,
              {
                recordId: failed.id,
                action: failed.action,
                errorCode,
                reason: "package-stale",
              },
            );
            await event(tx, failed.itemId, "DISTRIBUTION_ATTEMPT_RESULT", {
              attemptId: failed.id,
              state: failed.state,
              channelId: failed.channelId,
            });
            return {
              recordId: failed.id,
              action: failed.action,
              status: failed.state,
              error: { code: errorCode, message: errorMessage },
            };
          }
        }
        const delivered = await tx.distributionAttempt.update({
          where: { id: attempt.id },
          data: {
            state: "RUNNING",
            claimedBySessionId: session.id,
            leaseUntil: null,
            startedAt: attempt.startedAt || new Date(),
            finishedAt: null,
            attemptCount: { increment: 1 },
          },
        });
        await audit(
          tx,
          session.createdBy,
          "DISTRIBUTION_HANDOFF_DELIVERED",
          delivered.itemId,
          {
            recordId: delivered.id,
            action: delivered.action,
            channelId: delivered.channelId,
            packageId: delivered.packageId,
          },
        );
        await event(tx, delivered.itemId, "DISTRIBUTION_HANDOFF_DELIVERED", {
          attemptId: delivered.id,
          action: delivered.action,
          channelId: delivered.channelId,
        });
        return this.handoffPackagePayload(tx, delivered);
      },
    );
  }

  async handoffAsset(
    session: AgentSession,
    attemptId: string,
    assetId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const attempt = await tx.distributionAttempt.findFirst({
        where: { id: attemptId, channelId: session.channelId },
      });
      if (!attempt) throw new Fault("NOT_FOUND", "分发交付记录不存在", 404);
      await this.handoffScope(tx, attempt.channelId, attempt.action);
      if (
        attempt.state !== "RUNNING" ||
        attempt.claimedBySessionId !== session.id
      )
        throw new Fault(
          "HANDOFF_REQUIRED",
          "请先取得当前会话的标准交付资料",
          409,
        );
      if (!attempt.packageId)
        throw new Fault(
          "ASSET_UNAVAILABLE",
          "该停售交付只提供永久 TM 身份",
          404,
        );
      const { s, assets } = await this.publishing.validPackage(
        tx,
        attempt.packageId,
      );
      if (!s.assets.some((image) => image.id === assetId))
        throw new Fault(
          "ASSET_NOT_IN_PACKAGE",
          "图片不属于当前冻结使用包",
          403,
        );
      const asset = assets.find((row) => row.id === assetId);
      if (!asset)
        throw new Fault(
          "ASSET_NOT_IN_PACKAGE",
          "图片不属于当前冻结使用包",
          403,
        );
      return {
        mime: asset.mime,
        filename: `${asset.id}.${asset.mime.split("/")[1] || "bin"}`,
        bytes: await readFile(assetPath(asset.objectKey)),
      };
    });
  }

  async reportHandoffPublished(
    session: AgentSession,
    key: unknown,
    id: string,
    raw: unknown,
  ) {
    const input = handoffPublishedInput.parse(raw);
    noCredentialText(input.note, "交付确认说明");
    const result = checkedResult({
      state: "SUCCEEDED",
      remoteId: input.remoteId,
      remoteUrl: input.remoteUrl,
      evidence: { method: "MANUAL_CONFIRMATION", note: input.note },
    });
    return this.machineHandoffRun(
      session,
      "handoff.report-published",
      key,
      { recordId: id, ...input },
      async (tx) => {
        await lock(tx, `distribution-attempt:${id}`);
        const attempt = await tx.distributionAttempt.findFirst({
          where: { id, channelId: session.channelId },
        });
        if (!attempt) throw new Fault("NOT_FOUND", "分发交付记录不存在", 404);
        if (attempt.state === "UNKNOWN")
          throw new Fault(
            "RECONCILIATION_REQUIRED",
            "需要核对的记录只能由人工在原记录确认成功或失败",
            409,
          );
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.state)) {
          if (
            attempt.claimedBySessionId === session.id &&
            sameResult(attempt, result)
          )
            return {
              recordId: attempt.id,
              status: attempt.state,
              existing: true,
            };
          throw new Fault(
            "ATTEMPT_RESULT_CONFLICT",
            "该分发记录已有不同结果",
            409,
          );
        }
        if (
          attempt.state !== "RUNNING" ||
          attempt.claimedBySessionId !== session.id
        )
          throw new Fault(
            "HANDOFF_REQUIRED",
            "请先取得当前会话的标准交付资料",
            409,
          );
        const finished = await this.finish(
          tx,
          attempt,
          result,
          session.createdBy,
          "STANDARD_HANDOFF_REPORTED",
          false,
        );
        return {
          recordId: finished.id,
          status: finished.state,
          listingId: finished.listingId,
        };
      },
    );
  }

  async reportHandoffAttention(
    session: AgentSession,
    key: unknown,
    id: string,
    raw: unknown,
  ) {
    const input = handoffAttentionInput.parse(raw);
    noCredentialText(input.note, "交付待处理说明");
    const result = checkedResult({
      state: "UNKNOWN",
      errorCode: "EXTERNAL_ATTENTION",
      errorMessage: input.note,
    });
    return this.machineHandoffRun(
      session,
      "handoff.report-attention",
      key,
      { recordId: id, ...input },
      async (tx) => {
        await lock(tx, `distribution-attempt:${id}`);
        const attempt = await tx.distributionAttempt.findFirst({
          where: { id, channelId: session.channelId },
        });
        if (!attempt) throw new Fault("NOT_FOUND", "分发交付记录不存在", 404);
        if (attempt.state === "UNKNOWN")
          throw new Fault(
            "RECONCILIATION_REQUIRED",
            "需要核对的记录只能由人工在原记录确认成功或失败",
            409,
          );
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(attempt.state))
          throw new Fault("ATTEMPT_RESULT_CONFLICT", "该分发记录已有结果", 409);
        if (
          attempt.state !== "RUNNING" ||
          attempt.claimedBySessionId !== session.id
        )
          throw new Fault(
            "HANDOFF_REQUIRED",
            "请先取得当前会话的标准交付资料",
            409,
          );
        const finished = await this.finish(
          tx,
          attempt,
          result,
          session.createdBy,
          "STANDARD_HANDOFF_ATTENTION",
          false,
        );
        return { recordId: finished.id, status: finished.state };
      },
    );
  }

  private async distributionProfile(
    session: AgentSession,
  ): Promise<DistributionProfile> {
    const channel = await this.db.channel.findUnique({
      where: { id: session.channelId },
      select: { platform: true, active: true, businessPurpose: true },
    });
    if (!channel) throw new Fault("CHANNEL_NOT_FOUND", "渠道账号不存在", 404);
    const stopOnly =
      !channel.active || channel.businessPurpose !== "TRADE";
    const profile =
      profileForPlatform(channel.platform) ||
      (stopOnly ? GENERIC_STOP_PROFILE : undefined);
    if (!profile)
      throw new Fault(
        "DISTRIBUTION_PROFILE_UNAVAILABLE",
        `渠道 ${channel.platform} 没有可验证的标准分发 Profile；请由运营人员先指定渠道资料合同`,
        409,
      );
    return profile;
  }

  async agentProtocol(session: AgentSession) {
    const profile = await this.distributionProfile(session);
    const [skillDocument, profileDocument] = await Promise.all([
      readDistributionSkillDocument(),
      readDistributionProfileDocument(profile),
    ]);
    return {
      protocolVersion: DISTRIBUTION_PROTOCOL_VERSION,
      session: { channelId: session.channelId, agentName: session.agentName },
      skill: {
        id: DISTRIBUTION_SKILL_ID,
        name: DISTRIBUTION_SKILL_NAME,
        version: DISTRIBUTION_SKILL_VERSION,
        sha256: skillDocument.sha256,
        url: "/api/distribution-agent/skill",
      },
      profile: {
        id: profile.id,
        name: profile.name,
        platform: profile.platform,
        sha256: profileDocument.sha256,
        url: "/api/distribution-agent/profile",
      },
      handoff: {
        tools: [
          "tome_distribution_list_handoffs",
          "tome_distribution_get_package",
          "tome_distribution_report_published",
          "tome_distribution_report_attention",
        ],
        noAutoRetry: true,
      },
      unknownRule:
        "UNKNOWN 必须在原记录按永久 TM 核对；禁止新建第二个发布记录或自动重发。",
      documentation: "docs/DISTRIBUTION-HANDOFF-CONTRACT.md",
    };
  }

  async machineHandoffSkillDocument() {
    return readDistributionSkillDocument();
  }

  async machineHandoffProfileDocument(session: AgentSession) {
    const profile = await this.distributionProfile(session);
    return { profile, ...(await readDistributionProfileDocument(profile)) };
  }

  async agentAttempts(session: AgentSession) {
    const channel = await this.db.channel.findUnique({
      where: { id: session.channelId },
      select: { active: true, businessPurpose: true },
    });
    if (!channel) throw new Fault("CHANNEL_NOT_FOUND", "渠道账号不存在", 404);
    const stopOnly = !channel.active || channel.businessPurpose !== "TRADE";
    return this.db.distributionAttempt.findMany({
      where: {
        channelId: session.channelId,
        ...(stopOnly ? { action: "DELIST" } : {}),
        OR: [
          { state: { in: ["PENDING", "UNKNOWN"] } },
          { state: "RUNNING", claimedBySessionId: session.id },
        ],
      },
      select: {
        id: true,
        action: true,
        state: true,
        packageId: true,
        attemptCount: true,
        leaseUntil: true,
        createdAt: true,
        errorCode: true,
        errorMessage: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
  }

  async claim(session: AgentSession, id: string) {
    return this.db.$transaction(async (tx) => {
      await lock(tx, `distribution-attempt:${id}`);
      const attempt = await tx.distributionAttempt.findFirst({
        where: { id, channelId: session.channelId },
      });
      if (!attempt) throw new Fault("NOT_FOUND", "分发执行记录不存在", 404);
      await this.handoffScope(tx, attempt.channelId, attempt.action);
      const now = new Date();
      if (
        attempt.state === "RUNNING" &&
        attempt.leaseUntil &&
        attempt.leaseUntil > now
      ) {
        if (attempt.claimedBySessionId === session.id)
          return {
            id: attempt.id,
            state: attempt.state,
            leaseUntil: attempt.leaseUntil,
            existing: true,
            reconcile: false,
          };
        throw new Fault("ATTEMPT_LEASED", "该执行记录正由另一会话处理", 409);
      }
      if (!["PENDING", "UNKNOWN", "RUNNING"].includes(attempt.state))
        throw new Fault("CLAIM_NOT_ALLOWED", "当前执行状态不能领取", 409);
      const reconcile = attempt.state === "UNKNOWN";
      if (!reconcile && attempt.packageId) {
        try {
          await this.publishing.validPackage(tx, attempt.packageId);
        } catch (error) {
          const code = resultCode(error);
          const message =
            error instanceof Error ? error.message : "使用包不可用";
          const failed = await tx.distributionAttempt.update({
            where: { id },
            data: {
              state: "FAILED",
              errorCode: code,
              errorMessage: message,
              leaseUntil: null,
              finishedAt: now,
            },
          });
          await audit(
            tx,
            session.createdBy,
            "DISTRIBUTION_ATTEMPT_FAILED",
            failed.itemId,
            { attemptId: failed.id, errorCode: code, reason: "package-stale" },
          );
          await event(tx, failed.itemId, "DISTRIBUTION_ATTEMPT_RESULT", {
            attemptId: failed.id,
            state: failed.state,
            channelId: failed.channelId,
          });
          return {
            id: failed.id,
            state: failed.state,
            leaseUntil: null,
            reconcile: false,
            errorCode: code,
          };
        }
      }
      const leaseUntil = new Date(now.getTime() + this.leaseSeconds() * 1000);
      const claimed = await tx.distributionAttempt.update({
        where: { id },
        data: {
          state: "RUNNING",
          claimedBySessionId: session.id,
          leaseUntil,
          startedAt: attempt.startedAt || now,
          finishedAt: null,
          attemptCount: { increment: 1 },
        },
      });
      await audit(
        tx,
        session.createdBy,
        "DISTRIBUTION_ATTEMPT_CLAIMED",
        claimed.itemId,
        {
          attemptId: claimed.id,
          channelId: claimed.channelId,
          reconcile,
        },
      );
      return {
        id: claimed.id,
        state: claimed.state,
        leaseUntil: claimed.leaseUntil,
        reconcile,
      };
    });
  }

  private async activeClaim(tx: Tx, session: AgentSession, id: string) {
    const attempt = await tx.distributionAttempt.findFirst({
      where: { id, channelId: session.channelId },
    });
    if (!attempt) throw new Fault("NOT_FOUND", "分发执行记录不存在", 404);
    await this.handoffScope(tx, attempt.channelId, attempt.action);
    if (
      attempt.state !== "RUNNING" ||
      attempt.claimedBySessionId !== session.id ||
      !attempt.leaseUntil ||
      attempt.leaseUntil <= new Date()
    )
      throw new Fault("CLAIM_REQUIRED", "请先领取尚未过期的分发执行记录", 409);
    return attempt;
  }

  async agentPayload(session: AgentSession, id: string) {
    return this.db.$transaction(async (tx) => {
      const attempt = await this.activeClaim(tx, session, id);
      // UNKNOWN keeps its reason while being reclaimed. That is the explicit
      // reconciliation marker; a retried FAILED attempt has its reason cleared.
      const reconcile = !!attempt.errorCode;
      if (!attempt.packageId) {
        const item = await tx.item.findUniqueOrThrow({
          where: { id: attempt.itemId },
        });
        const channel = await tx.channel.findUniqueOrThrow({
          where: { id: attempt.channelId },
        });
        return {
          attemptId: attempt.id,
          action: attempt.action,
          reconcile,
          channel: {
            id: channel.id,
            platform: channel.platform,
            name: channel.name,
            locale: channel.locale,
          },
          product: {
            id: item.id,
            code: tm(item.serial),
            title: item.title,
            locator: `标题中的 ${tm(item.serial)}`,
          },
        };
      }
      if (reconcile) {
        const pack = await tx.usePackage.findUnique({
          where: { id: attempt.packageId },
          include: { item: true, channel: true },
        });
        if (!pack) throw new Fault("NOT_FOUND", "使用包不存在", 404);
        const snapshot = packageSnapshot.parse(pack.snapshot);
        return {
          attemptId: attempt.id,
          action: attempt.action,
          reconcile: true,
          channel: {
            id: pack.channel.id,
            platform: pack.channel.platform,
            name: pack.channel.name,
            locale: pack.channel.locale,
          },
          product: {
            id: pack.item.id,
            code: snapshot.code,
            title: snapshot.title,
            locator: `标题中的 ${snapshot.code}`,
          },
        };
      }
      const pack = await this.publishing.validPackage(tx, attempt.packageId);
      return {
        attemptId: attempt.id,
        action: attempt.action,
        reconcile,
        channel: {
          id: pack.p.channel.id,
          platform: pack.p.channel.platform,
          name: pack.p.channel.name,
          locale: pack.p.channel.locale,
        },
        product: {
          id: pack.p.item.id,
          code: pack.s.code,
          title: pack.s.title,
          body: pack.s.body,
          price: pack.s.price,
          currency: pack.s.currency,
          images: pack.s.assets.map((image) => ({
            id: image.id,
            role:
              pack.assets.find((asset) => asset.id === image.id)?.role ||
              "PRODUCT",
            position: image.position,
            download: `/api/distribution-agent/attempts/${attempt.id}/assets/${image.id}`,
          })),
        },
      };
    });
  }

  // This is a read-only local handoff payload, not an AnQiCMS connector. An
  // external Agent owns HTTP, credentials, retry policy and remote writes.
  async agentAnqicmsSpikePayload(session: AgentSession, id: string) {
    return this.db.$transaction(async (tx) => {
      const attempt = await this.activeClaim(tx, session, id);
      const channel = await tx.channel.findUniqueOrThrow({
        where: { id: attempt.channelId },
        select: { id: true, platform: true, name: true, locale: true },
      });
      return {
        attemptId: attempt.id,
        channel,
        payload: await this.anqicmsHandoffPayload(tx, attempt, "attempts"),
      };
    });
  }

  async agentAsset(session: AgentSession, attemptId: string, assetId: string) {
    return this.db.$transaction(async (tx) => {
      const attempt = await this.activeClaim(tx, session, attemptId);
      if (!attempt.packageId)
        throw new Fault(
          "ASSET_UNAVAILABLE",
          "该执行记录没有可分发的使用包",
          404,
        );
      if (attempt.errorCode)
        throw new Fault(
          "RECONCILIATION_ONLY",
          "结果未知的核对只允许使用永久TM定位，不能重新下载素材或再次发布",
          409,
        );
      const { s, assets } = await this.publishing.validPackage(
        tx,
        attempt.packageId,
      );
      if (!s.assets.some((image) => image.id === assetId))
        throw new Fault(
          "ASSET_NOT_IN_PACKAGE",
          "图片不属于当前分发使用包",
          403,
        );
      const asset = assets.find((row) => row.id === assetId);
      if (!asset)
        throw new Fault(
          "ASSET_NOT_IN_PACKAGE",
          "图片不属于当前分发使用包",
          403,
        );
      return {
        mime: asset.mime,
        filename: `${asset.id}.${asset.mime.split("/")[1] || "bin"}`,
        bytes: await readFile(assetPath(asset.objectKey)),
      };
    });
  }

  async agentResult(session: AgentSession, id: string, raw: unknown) {
    const result = checkedResult(raw);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `distribution-attempt:${id}`);
      const attempt = await tx.distributionAttempt.findFirst({
        where: { id, channelId: session.channelId },
      });
      if (!attempt) throw new Fault("NOT_FOUND", "分发执行记录不存在", 404);
      if (["SUCCEEDED", "FAILED", "UNKNOWN"].includes(attempt.state)) {
        if (
          attempt.claimedBySessionId === session.id &&
          sameResult(attempt, result)
        )
          return { id: attempt.id, state: attempt.state, existing: true };
        throw new Fault(
          "ATTEMPT_RESULT_CONFLICT",
          "该执行记录已有不同结果",
          409,
        );
      }
      if (
        attempt.state !== "RUNNING" ||
        attempt.claimedBySessionId !== session.id ||
        !attempt.leaseUntil ||
        attempt.leaseUntil <= new Date()
      )
        throw new Fault(
          "CLAIM_REQUIRED",
          "请先领取尚未过期的分发执行记录",
          409,
        );
      return this.finish(
        tx,
        attempt,
        result,
        session.createdBy,
        "AGENT_REPORTED_LIVE",
        false,
      );
    });
  }
}
