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
import { itemLock } from "../catalog/catalog.service";
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
import { factsSchema, safeText, tm, uuid } from "../common/domain";
import { PrismaService } from "../database/prisma.service";
import { assetPath } from "../media/storage";
import {
  packageSnapshot,
  PublishingService,
} from "../publishing/publishing.service";
import { buildAnqicmsSpikePayload } from "./anqicms-spike";

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
const listingReceiptInput = z
  .object({
    packageId: uuid,
    remoteId: safeText(300).min(1),
    url: remoteUrl.default(""),
  })
  .strict();

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
  actorId: string,
  itemId: string,
  cycle: number,
  reason: string,
) {
  const published = await tx.distributionAttempt.findMany({
    where: {
      itemId,
      action: { in: ["PUBLISH", "UPDATE"] },
      state: "SUCCEEDED",
      package: { is: { cycle } },
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
    await audit(tx, actorId, "DISTRIBUTION_ATTEMPT_PLANNED", itemId, {
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
  ) {}

  private leaseSeconds() {
    const value = Number(process.env.DISTRIBUTION_LEASE_SECONDS || 120);
    const min = process.env.APP_ENV === "test" ? 1 : 30;
    if (!Number.isInteger(value) || value < min || value > 900)
      throw new Error("Invalid distribution lease duration");
    return value;
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
        if (!channel?.active)
          throw new Fault("CHANNEL_UNAVAILABLE", "渠道账号未启用", 400);
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
        });
        return {
          response: {
            id: session.id,
            channelId: session.channelId,
            expiresAt: session.expiresAt,
            token,
          },
          receipt: {
            id: session.id,
            channelId: session.channelId,
            expiresAt: session.expiresAt.toISOString(),
            tokenIssued: true,
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
    const dedupeKey = [
      action.toLowerCase(),
      p.itemId,
      p.channelId,
      p.id,
      ...(delistedAfterPublish && completedDelist
        ? ["after", completedDelist.id]
        : []),
    ].join(":");
    const exact = await tx.distributionAttempt.findUnique({
      where: { dedupeKey },
    });
    if (exact)
      return {
        p,
        existing: exact,
        action: exact.action,
        reason: "SAME_PACKAGE" as const,
      };
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
    attempt: { itemId: string; channelId: string; packageId: string | null },
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
    const item = await itemLock(tx, attempt.itemId);
    const listing =
      result.state !== "SUCCEEDED"
        ? null
        : attempt.action === "DELIST"
          ? await this.recordDelist(tx, attempt, result, actorId, observed)
          : result.remoteId
            ? await this.upsertListing(
                tx,
                attempt,
                result.remoteId,
                result.remoteUrl,
                actorId,
                observed,
              )
            : null;
    const row = await tx.distributionAttempt.update({
      where: { id: attempt.id },
      data: {
        state: result.state,
        remoteId: result.remoteId,
        remoteUrl: result.remoteUrl,
        evidence: json(result.evidence || {}),
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        ...(incrementAttempt ? { attemptCount: { increment: 1 } } : {}),
        leaseUntil: null,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    // An item can stop being saleable while an external handoff is still in
    // flight. A late successful PUBLISH/UPDATE must therefore create the same
    // source-linked stop fact as the inventory transition would have created.
    const delistAttemptIds =
      result.state === "SUCCEEDED" &&
      ["PUBLISH", "UPDATE"].includes(row.action) &&
      item.status !== "AVAILABLE"
        ? await planStopDistribution(
            tx,
            actorId,
            row.itemId,
            item.cycle,
            `LATE_HANDOFF_AFTER_${item.status}`,
          )
        : [];
    await audit(
      tx,
      actorId,
      `DISTRIBUTION_ATTEMPT_${result.state}`,
      row.itemId,
      {
        attemptId: row.id,
        action: row.action,
        channelId: row.channelId,
        packageId: row.packageId,
        remoteId: row.remoteId || null,
        listingId: listing?.id || null,
        errorCode: row.errorCode || null,
        delistAttemptIds,
      },
    );
    await event(tx, row.itemId, "DISTRIBUTION_ATTEMPT_RESULT", {
      attemptId: row.id,
      state: row.state,
      channelId: row.channelId,
      listingId: listing?.id || null,
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

  async agentProtocol(session: AgentSession) {
    return {
      protocolVersion: "1.0",
      session: { channelId: session.channelId, agentName: session.agentName },
      actions: ["PUBLISH", "UPDATE", "DELIST", "VERIFY"],
      resultStates: ["SUCCEEDED", "FAILED", "UNKNOWN"],
      unknownRule:
        "UNKNOWN 必须领取原 Attempt 并通过永久TM核对；禁止新建第二个发布 Attempt。",
    };
  }

  async agentAttempts(session: AgentSession) {
    return this.db.distributionAttempt.findMany({
      where: {
        channelId: session.channelId,
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

  // This is a read-only local Spike payload, not an AnQiCMS connector. The
  // later connector owns HTTP, credentials, retry policy and remote writes.
  async agentAnqicmsSpikePayload(session: AgentSession, id: string) {
    return this.db.$transaction(async (tx) => {
      const attempt = await this.activeClaim(tx, session, id);
      const channel = await tx.channel.findUniqueOrThrow({
        where: { id: attempt.channelId },
      });
      if (channel.platform !== "ANQICMS")
        throw new Fault(
          "ANQICMS_CHANNEL_REQUIRED",
          "只有 AnQiCMS API 渠道可以读取 Spike 资料合同",
          409,
        );

      const historical = attempt.action === "DELIST";
      let packageId = attempt.packageId;
      if (!packageId && historical) {
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
          select: { packageId: true },
        });
        packageId = source?.packageId || null;
      }
      if (!packageId)
        throw new Fault(
          "ANQICMS_PACKAGE_REQUIRED",
          "AnQiCMS Spike 需要当前或历史发布使用包，不能凭空拼装资料",
          409,
        );
      const pack = await this.publishing.validPackage(
        tx,
        packageId,
        historical,
      );
      if (pack.s.price === null || pack.s.currency !== "USD")
        throw new Fault(
          "ANQICMS_USD_REQUIRED",
          "AnQiCMS Spike 只接受已冻结的 USD 渠道报价",
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
          "Spike 需要冻结版本中的品牌、分类和已批准商品事实",
          409,
        );
      const facts = factsSchema.parse(approved.facts);
      const attribute = (key: string) => {
        const value = facts.attributes[key];
        return typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
          ? String(value)
          : "";
      };
      const byId = new Map(pack.assets.map((asset) => [asset.id, asset]));
      const images = historical
        ? []
        : pack.s.assets.map((image) => {
            const asset = byId.get(image.id);
            if (!asset)
              throw new Fault(
                "ANQICMS_IMAGE_REQUIRED",
                "使用包缺少已批准图片，不能生成 Spike 资料",
                409,
              );
            if (!["PRODUCT", "DETAIL", "DEFECT"].includes(asset.role))
              throw new Fault(
                "ANQICMS_IMAGE_ROLE_INVALID",
                "AnQiCMS Spike 只能使用已批准的实物、细节或瑕疵图片",
                409,
              );
            return {
              id: image.id,
              role: asset.role as "PRODUCT" | "DETAIL" | "DEFECT",
              position: image.position,
              download: `/api/distribution-agent/attempts/${attempt.id}/assets/${image.id}`,
            };
          });
      const listing = await tx.listing.findFirst({
        where: { itemId: attempt.itemId, channelId: attempt.channelId },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      });
      const payload = buildAnqicmsSpikePayload({
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
          condition: facts.condition,
          size: facts.sizeLabel || attribute("size"),
          color: facts.color || attribute("color"),
          material: facts.mainMaterial || facts.material || attribute("material"),
          measurements: facts.measurements,
          year: attribute("year"),
          collection: attribute("collection"),
          styleNumber: attribute("style_number"),
        },
        images,
        listing: listing
          ? { archiveId: listing.remoteId, url: listing.url }
          : null,
      });
      return {
        attemptId: attempt.id,
        channel: {
          id: channel.id,
          platform: channel.platform,
          name: channel.name,
          locale: channel.locale,
        },
        payload,
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
