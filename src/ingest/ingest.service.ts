import { imageCommand, type PreparedImage } from "../media/storage";
import sharp from "sharp";
import { assetPath } from "../media/storage";
import {
  inspectCapture,
  record,
  batchManifest,
  type Integrity,
} from "./ingest-integrity";
import {
  INGEST_PROTOCOL_VERSION,
  INGEST_SKILL_ID,
  INGEST_SKILL_NAME,
  INGEST_SKILL_VERSION,
  assertNewMachineBatchManifest,
  effectiveRequiredFields,
  profileForSourceCode,
  readProfileDocument,
  readSkillDocument,
  type IngestProfile,
} from "./ingest-standard";
import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import {
  Commands,
  audit,
  hash,
  json,
  lock,
  type Tx,
} from "../common/transaction";
import { digest, permission, type Actor, type Role } from "../auth/auth";
import { authorizationContext } from "../auth/request-context";
import { Fault } from "../common/errors";
import {
  createItemInTx,
  newItem,
  type NewItemInput,
} from "../catalog/catalog.service";
import { factsSchema, tm } from "../common/domain";
import { proposalFor } from "./ingest.logic";
import type { z } from "zod";
import { ingestCandidateInput } from "./ingest.schemas";
import { assertNoSensitiveIngestData } from "./ingest-security";

type CandidateInput = z.infer<typeof ingestCandidateInput>;
type MachineSession = {
  id: string;
  createdBy: string;
  procurementSourceId: string;
};

function mergeSourceFacts(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (key === "capture") result[key] = value;
    else if (value && typeof value === "object" && !Array.isArray(value))
      result[key] = mergeSourceFacts(record(previous[key]), record(value));
    else if (value !== null && value !== "") result[key] = value;
  }
  return result;
}
@Injectable()
export class IngestService {
  constructor(
    private db: PrismaService,
    private commands: Commands,
  ) {}

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
          throw new Fault("IDEMPOTENCY_CONFLICT", "相同幂等键对应不同内容", 409);
        throw new Fault(
          "TOKEN_ALREADY_ISSUED",
          "导入令牌仅在首次创建时显示。请撤销旧会话后创建新的会话。",
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

  private async assertLiveMachineSession(tx: Tx, session: MachineSession) {
    const live = await tx.ingestSession.findUnique({
      where: { id: session.id },
    });
    if (
      !live ||
      live.revokedAt ||
      live.expiresAt <= new Date() ||
      live.createdBy !== session.createdBy ||
      live.procurementSourceId !== session.procurementSourceId
    )
      throw new Fault("INGEST_SESSION_EXPIRED", "导入会话已失效", 401);
    const [users, sources] = await Promise.all([
      tx.$queryRaw<{ active: boolean; role: string }[]>`
        SELECT "active","role" FROM "User"
        WHERE "id"=${session.createdBy}::uuid FOR SHARE
      `,
      tx.$queryRaw<{ active: boolean }[]>`
        SELECT "active" FROM "ProcurementSource"
        WHERE "id"=${session.procurementSourceId}::uuid FOR SHARE
      `,
    ]);
    if (!users[0]?.active || !permission(users[0].role as Role, "supply"))
      throw new Fault(
        "INGEST_CREATOR_REVOKED",
        "导入会话创建者已停用或失去货源权限",
        403,
      );
    if (!sources[0]?.active)
      throw new Fault(
        "INGEST_SOURCE_UNAVAILABLE",
        "导入来源已停用，现有机器会话不得继续写入",
        403,
      );
    return live;
  }

  private async sourceProfile(session: MachineSession): Promise<IngestProfile> {
    const source = await this.db.procurementSource.findUnique({
      where: { id: session.procurementSourceId },
      select: { code: true },
    });
    if (!source)
      throw new Fault("INGEST_SOURCE_UNAVAILABLE", "导入来源不存在", 404);
    return profileForSourceCode(source.code);
  }

  async machineProtocol(session: MachineSession) {
    const profile = await this.sourceProfile(session),
      skill = await readSkillDocument(),
      profileDocument = await readProfileDocument(profile);
    return {
      version: INGEST_PROTOCOL_VERSION,
      skill: {
        name: INGEST_SKILL_NAME,
        version: INGEST_SKILL_VERSION,
        id: INGEST_SKILL_ID,
        sha256: skill.sha256,
        url: "/api/agent-ingest/skill",
      },
      profile: {
        id: profile.id,
        name: profile.name,
        sha256: profileDocument.sha256,
        url: "/api/agent-ingest/profile",
        requiredFields: profile.requiredFields,
      },
      batchManifest: {
        protocolVersion: INGEST_PROTOCOL_VERSION,
        skillVersion: INGEST_SKILL_ID,
        profile: profile.id,
        expectedCandidateKeys: ["source:item-key"],
        requiredFields: ["sourceFacts.description"],
      },
      captureLocation: "candidate.sourceFacts.capture",
      imageFields: [
        "sourceUrl",
        "sha256",
        "width",
        "height",
        "quality",
        "reason",
      ],
      imageQuality: [
        "ORIGINAL",
        "LARGEST_AVAILABLE",
        "THUMBNAIL",
        "UNAVAILABLE",
      ],
      fieldCheck: {
        path: "sourceFacts.sizeLabel",
        label: "标签尺码",
        status: "UNAVAILABLE",
        reason: "来源页面未提供",
      },
      agentProposal: {
        location: "candidate.agentProposal",
        policy:
          "Suggestions stay separate from sourceFacts and are adopted only through human candidate confirmation.",
        generator: ["LLM", "RULES", "HYBRID"],
        methods: ["EXTRACTED", "NORMALIZED", "TRANSLATED", "INFERRED"],
        confidence: { minimum: 0, maximum: 1 },
        fields: [
          { path: "title", input: "TEXT", maxLength: 500 },
          { path: "brand", input: "DICTIONARY_LABEL", maxLength: 160 },
          {
            path: "category",
            input: "SELECT",
            options: ["CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"],
          },
          { path: "facts.material", input: "TEXT", maxLength: 300 },
          { path: "facts.color", input: "TEXT", maxLength: 100 },
          { path: "facts.sizeLabel", input: "TEXT", maxLength: 100 },
          {
            path: "facts.measurements",
            input: "MULTILINE_TEXT",
            maxLength: 1500,
            format: "每行一个 项目: 数值，保留来源单位",
          },
          {
            path: "facts.descriptionZh",
            input: "MULTILINE_TEXT",
            maxLength: 12000,
          },
        ],
        forbidden:
          "TM identity, inventory, local condition grade, authentication, CNY cost, sale price, transaction, public rights and publishing",
      },
      completion:
        "GET /batches/:id reports the union of server Profile fields and the agent manifest; seal refuses missing items/files. Source-only gaps remain visible for human review.",
      documentation: "docs/AGENT-INGEST-PROTOCOL.md",
    };
  }

  async machineSkillDocument() {
    return readSkillDocument();
  }

  async machineProfileDocument(session: MachineSession) {
    const profile = await this.sourceProfile(session),
      document = await readProfileDocument(profile);
    return { profile, ...document };
  }

  createSession(
    actor: Actor,
    key: unknown,
    input: { procurementSourceId: string; label: string; ttlMinutes: number },
  ) {
    assertNoSensitiveIngestData(input, "导入会话");
    const token = randomBytes(32).toString("hex"),
      tokenHash = digest(token);
    return this.credentialCommand(
      actor,
      "ingest.session.create",
      key,
      input,
      async (tx) => {
        const source = await tx.procurementSource.findUnique({
          where: { id: input.procurementSourceId },
        });
        if (!source?.active)
          throw new Fault(
            "INGEST_SOURCE_UNAVAILABLE",
            "采集来源不存在或已停用",
            400,
          );
        const row = await tx.ingestSession.create({
          data: {
            procurementSourceId: input.procurementSourceId,
            label: input.label,
            tokenHash,
            createdBy: actor.id,
            expiresAt: new Date(Date.now() + input.ttlMinutes * 60000),
          },
        });
        await audit(tx, actor.id, "INGEST_SESSION_CREATED", row.id, {
          sourceId: input.procurementSourceId,
          label: input.label,
          expiresAt: row.expiresAt,
        });
        return {
          response: {
            id: row.id,
            token,
            expiresAt: row.expiresAt,
            source: { id: source.id, code: source.code, name: source.name },
          },
          receipt: {
            id: row.id,
            sourceId: source.id,
            expiresAt: row.expiresAt.toISOString(),
            tokenIssued: true,
          },
        };
      },
    );
  }

  async machineRun<T extends Record<string, unknown>>(
    session: MachineSession,
    operation: string,
    key: unknown,
    input: unknown,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{12,128}$/.test(key))
      throw new Fault(
        "IDEMPOTENCY_REQUIRED",
        "机器导入写操作需要12—128位幂等键",
        400,
      );
    assertNoSensitiveIngestData(input, "机器导入请求");
    const op = `machine.ingest.${session.id}.${operation}`,
      requestHash = hash(input);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx, `machine-ingest:${session.id}:${key}`);
        await this.assertLiveMachineSession(tx, session);
        const old = await tx.receipt.findUnique({
          where: {
            actorId_operation_key: {
              actorId: session.createdBy,
              operation: op,
              key,
            },
          },
        });
        if (old) {
          if (old.requestHash !== requestHash)
            throw new Fault(
              "IDEMPOTENCY_CONFLICT",
              "相同幂等键对应不同导入内容",
              409,
            );
          return old.response as T;
        }
        const result = await fn(tx);
        await tx.ingestSession.update({
          where: { id: session.id },
          data: { lastUsedAt: new Date() },
        });
        await tx.receipt.create({
          data: {
            actorId: session.createdBy,
            operation: op,
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

  async upsertCandidate(
    tx: Tx,
    batchId: string,
    sourceId: string,
    input: CandidateInput,
    defaultCurrency: string,
  ) {
    await lock(tx, `ingest-identity:${sourceId}:${input.externalKey}`);
    if (input.purchaseLineId) {
      const line = await tx.purchaseLine.findUnique({
        where: { id: input.purchaseLineId },
        include: { order: { select: { procurementSourceId: true } } },
      });
      if (!line || line.order.procurementSourceId !== sourceId)
        throw new Fault(
          "INGEST_PURCHASE_LINE_SCOPE",
          "采购订单行不属于当前导入来源",
          400,
        );
    }
    let old = await tx.ingestCandidate.findUnique({
      where: {
        procurementSourceId_externalKey: {
          procurementSourceId: sourceId,
          externalKey: input.externalKey,
        },
      },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (old) {
      await lock(tx, "ingest-candidate:" + old.id);
      old = await tx.ingestCandidate.findUniqueOrThrow({
        where: { id: old.id },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      });
      // Sparse retries enrich source facts; they cannot clear collected evidence
      // or replace an operator's local proposal with a new machine suggestion.
      const merged = { ...input };
      for (const k of [
        "sourceItemKey",
        "brandRaw",
        "categoryRaw",
        "conditionRaw",
        "statusRaw",
      ] as const)
        if (!merged[k]) merged[k] = old[k];
      for (const k of [
        "purchaseLineId",
        "sourceLineAmount",
        "sourceLineNetAmount",
        "sourceCurrentPrice",
        "sourceEstimatedRetail",
      ] as const)
        if (merged[k] === null) Object.assign(merged, { [k]: old[k] });
      merged.sourceFacts = mergeSourceFacts(
        record(old.sourceFacts),
        input.sourceFacts,
      );
      merged.rawPayload = Object.keys(input.rawPayload).length
        ? input.rawPayload
        : record(old.rawPayload);
      if (!input.agentProposal) {
        const previous = record(old.revisions[0]?.snapshot).agentProposal;
        if (previous)
          merged.agentProposal = previous as CandidateInput["agentProposal"];
      }
      input = merged;
    }
    input = ingestCandidateInput.parse({
      ...input,
      currency: input.currency ?? old?.currency ?? defaultCurrency,
    });
    const { proposal, warnings } = await proposalFor(tx, input),
      snapshot = { ...input, proposal, warnings };
    if (
      old?.batchId === batchId &&
      old.revisions[0] &&
      hash(old.revisions[0].snapshot) === hash(snapshot)
    )
      return { id: old.id, version: old.version, unchanged: true };
    const values = {
      batchId,
      procurementSourceId: sourceId,
      externalKey: input.externalKey,
      sourceItemKey: input.sourceItemKey,
      purchaseLineId: input.purchaseLineId,
      titleRaw: input.titleRaw,
      brandRaw: input.brandRaw,
      categoryRaw: input.categoryRaw,
      conditionRaw: input.conditionRaw,
      statusRaw: input.statusRaw,
      currency: input.currency,
      sourceLineAmount: input.sourceLineAmount,
      sourceLineNetAmount: input.sourceLineNetAmount,
      sourceCurrentPrice: input.sourceCurrentPrice,
      sourceEstimatedRetail: input.sourceEstimatedRetail,
      sourceFacts: json(input.sourceFacts),
      proposal:
        old &&
        hash(old.proposal) !== hash(record(old.revisions[0]?.snapshot).proposal)
          ? json(old.proposal)
          : json(proposal),
      rawPayload: json(input.rawPayload),
      warnings,
    };
    const row = old
      ? await tx.ingestCandidate.update({
          where: { id: old.id },
          data: { ...values, version: { increment: 1 } },
        })
      : await tx.ingestCandidate.create({ data: values });
    await tx.ingestCandidateRevision.create({
      data: {
        candidateId: row.id,
        version: row.version,
        snapshot: json(snapshot),
      },
    });
    await tx.ingestBatchMember.createMany({
      data: [{ batchId, candidateId: row.id, firstVersion: row.version }],
      skipDuplicates: true,
    });
    return { id: row.id, version: row.version, unchanged: false };
  }

  async ensureSource(actor: Actor, key: string, candidateId: string) {
    return this.commands.run(
      actor.id,
      "ingest.candidate.source",
      key,
      { candidateId },
      async (tx) => {
        await lock(tx, "ingest-candidate:" + candidateId);
        const c = await tx.ingestCandidate.findUniqueOrThrow({
          where: { id: candidateId },
          include: { procurementSource: true },
        });
        if (c.sourceId) return { id: c.sourceId, existing: true };
        const sourceKey = `INGEST:${c.procurementSource.code}:${hash([c.procurementSourceId, c.externalKey]).slice(0, 24)}`;
        await lock(tx, "sourceKey:" + sourceKey);
        let source = await tx.source.findUnique({ where: { sourceKey } });
        const proposal = record(c.proposal),
          payload = {
            ingestCandidateId: c.id,
            externalKey: c.externalKey,
            sourceItemKey: c.sourceItemKey,
            titleRaw: c.titleRaw,
            brandRaw: c.brandRaw,
            categoryRaw: c.categoryRaw,
            conditionRaw: c.conditionRaw,
            statusRaw: c.statusRaw,
            currency: c.currency,
            sourceLineAmount: c.sourceLineAmount,
            sourceLineNetAmount: c.sourceLineNetAmount,
            sourceCurrentPrice: c.sourceCurrentPrice,
            sourceEstimatedRetail: c.sourceEstimatedRetail,
            sourceFacts: c.sourceFacts,
            ...(Array.isArray(proposal.agentFields)
              ? {
                  agentProposal: {
                    agent: proposal.agent,
                    fields: proposal.agentFields,
                  },
                }
              : {}),
            rawPayload: c.rawPayload,
          };
        if (!source) {
          source = await tx.source.create({
            data: {
              sourceKey,
              title: c.titleRaw,
              purchaseLineId: c.purchaseLineId,
              payload: json(payload),
              supplierId: c.procurementSource.supplierId,
            },
          });
          await tx.sourceRevision.create({
            data: { sourceId: source.id, version: 1, payload: json(payload) },
          });
        }
        await tx.ingestCandidate.update({
          where: { id: c.id },
          data: { sourceId: source.id },
        });
        await audit(tx, actor.id, "INGEST_CANDIDATE_SOURCE_CREATED", c.id, {
          sourceId: source.id,
          sourceKey,
        });
        return { id: source.id };
      },
    );
  }

  private itemFacts(
    sourceFacts: unknown,
    sourceName: string,
    conditionRaw: string,
    brandRaw: string,
    proposalValue: unknown,
  ) {
    const f =
      sourceFacts &&
      typeof sourceFacts === "object" &&
      !Array.isArray(sourceFacts)
        ? (sourceFacts as Record<string, unknown>)
        : {};
    const str = (...keys: string[]) => {
      for (const k of keys) {
        const v = f[k];
        if (typeof v === "string") return v;
        if (typeof v === "number") return String(v);
      }
      return "";
    };
    const proposal = record(proposalValue),
      proposedFacts = record(proposal.facts),
      proposed = (key: string) =>
        typeof proposedFacts[key] === "string"
          ? String(proposedFacts[key]).trim()
          : "";
    const sourceMeasurements =
      typeof f.measurements === "object" && f.measurements
        ? Object.entries(f.measurements as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join("\n")
        : str("measurements");
    const measurements = proposed("measurements") || sourceMeasurements;
    const sourceColor = str("color", "colorRaw");
    const attrs: Record<string, string> = {};
    const labels: Record<string, string> = {};
    for (const [key, label, value] of [
      ["sourcePlatform", "来源平台", sourceName],
      ["sourceBrand", "来源品牌", brandRaw],
      [
        "sourceConditionDetails",
        "来源品相说明",
        str("conditionDescription", "conditionNotes"),
      ],
    ]) {
      if (value) {
        attrs[key] = value.slice(0, 1000);
        labels[key] = label;
      }
    }
    if (sourceColor) {
      attrs.sourceColor = sourceColor;
      labels.sourceColor = "来源颜色";
    }
    if (conditionRaw) {
      attrs.sourceCondition = conditionRaw;
      labels.sourceCondition = "来源成色";
    }
    return factsSchema.parse({
      material: proposed("material") || str("material", "materialRaw"),
      color: proposed("color"),
      sizeLabel: proposed("sizeLabel") || str("sizeLabel", "size"),
      measurements,
      measurementSource: proposed("measurements")
        ? `${sourceName}来源证据 · 外部Agent整理建议（人工确认采用）`
        : measurements
          ? `${sourceName} · Agent来源资料`
          : "",
      condition: "",
      descriptionZh: proposed("descriptionZh") || str("descriptionZh"),
      descriptionEn: str("descriptionEn", "descriptionRaw", "description"),
      attributes: attrs,
      attributeLabels: labels,
    });
  }

  async ensureSourceInTx(tx: Tx, actor: Actor, candidateId: string) {
    await lock(tx, "ingest-candidate:" + candidateId);
    const c = await tx.ingestCandidate.findUniqueOrThrow({
      where: { id: candidateId },
      include: { procurementSource: true },
    });
    if (c.sourceId) {
      const source = await tx.source.findUniqueOrThrow({
        where: { id: c.sourceId },
      });
      return { candidate: c, source };
    }
    const sourceKey = `INGEST:${c.procurementSource.code}:${hash([c.procurementSourceId, c.externalKey]).slice(0, 24)}`;
    await lock(tx, "sourceKey:" + sourceKey);
    let source = await tx.source.findUnique({ where: { sourceKey } });
    const proposal = record(c.proposal),
      payload = {
        ingestCandidateId: c.id,
        externalKey: c.externalKey,
        sourceItemKey: c.sourceItemKey,
        titleRaw: c.titleRaw,
        brandRaw: c.brandRaw,
        categoryRaw: c.categoryRaw,
        conditionRaw: c.conditionRaw,
        statusRaw: c.statusRaw,
        currency: c.currency,
        sourceLineAmount: c.sourceLineAmount,
        sourceLineNetAmount: c.sourceLineNetAmount,
        sourceCurrentPrice: c.sourceCurrentPrice,
        sourceEstimatedRetail: c.sourceEstimatedRetail,
        sourceFacts: c.sourceFacts,
        ...(Array.isArray(proposal.agentFields)
          ? {
              agentProposal: {
                agent: proposal.agent,
                fields: proposal.agentFields,
              },
            }
          : {}),
        rawPayload: c.rawPayload,
      };
    if (!source) {
      source = await tx.source.create({
        data: {
          sourceKey,
          title: c.titleRaw,
          purchaseLineId: c.purchaseLineId,
          payload: json(payload),
          supplierId: c.procurementSource.supplierId,
        },
      });
      await tx.sourceRevision.create({
        data: { sourceId: source.id, version: 1, payload: json(payload) },
      });
    }
    await tx.ingestCandidate.update({
      where: { id: c.id },
      data: { sourceId: source.id },
    });
    await audit(tx, actor.id, "INGEST_CANDIDATE_SOURCE_CREATED", c.id, {
      sourceId: source.id,
      sourceKey,
    });
    return { candidate: { ...c, sourceId: source.id }, source };
  }

  async candidateMatches(id: string) {
    const c = await this.db.ingestCandidate.findUniqueOrThrow({
      where: { id },
      include: {
        assets: { select: { sha256: true } },
        source: { select: { id: true } },
        purchaseLine: {
          select: {
            id: true,
            itemLink: { select: { itemId: true } },
          },
        },
      },
    });
    const reasons = new Map<string, Set<string>>();
    const add = (itemId: string | undefined | null, reason: string) => {
      if (!itemId) return;
      const set = reasons.get(itemId) ?? new Set<string>();
      set.add(reason);
      reasons.set(itemId, set);
    };
    add(c.purchaseLine?.itemLink?.itemId, "采购订单行已经关联此TM");
    if (c.source?.id) {
      const links = await this.db.itemSourceLink.findMany({
        where: { sourceId: c.source.id },
        select: { itemId: true },
      });
      for (const link of links) add(link.itemId, "同一来源证据已经关联此TM");
    }
    const shas = [...new Set(c.assets.map((a) => a.sha256))];
    if (shas.length) {
      const assets = await this.db.asset.findMany({
        where: {
          sha256: { in: shas },
          item: { deletedAt: null, dataMode: "BUSINESS" },
        },
        select: { itemId: true },
      });
      for (const asset of assets) add(asset.itemId, "存在完全相同的来源图片");
    }
    if (c.sourceItemKey) {
      const lines = await this.db.purchaseLine.findMany({
        where: {
          sourceSku: c.sourceItemKey,
          order: { procurementSourceId: c.procurementSourceId },
          itemLink: { isNot: null },
        },
        select: { itemLink: { select: { itemId: true } } },
        take: 20,
      });
      for (const line of lines)
        add(line.itemLink?.itemId, "同一采购来源货号已经关联此TM");
    }
    if (!reasons.size) return [];
    const items = await this.db.item.findMany({
      where: {
        id: { in: [...reasons.keys()] },
        deletedAt: null,
        dataMode: "BUSINESS",
      },
      select: {
        id: true,
        serial: true,
        title: true,
        brand: true,
        status: true,
      },
    });
    return items
      .map((item) => ({
        ...item,
        code: tm(item.serial),
        reasons: [...(reasons.get(item.id) ?? [])],
      }))
      .sort(
        (a, b) => b.reasons.length - a.reasons.length || b.serial - a.serial,
      );
  }

  linkCandidateToItem(
    actor: Actor,
    key: unknown,
    id: string,
    input: {
      version: number;
      itemRef: string;
      possession: "IN_HAND" | "NOT_IN_HAND";
      note: string;
    },
  ) {
    return this.commands.run(
      actor.id,
      "ingest.candidate.link-item",
      key,
      { id, ...input },
      async (tx) => {
        await lock(tx, "ingest-candidate:" + id);
        const current = await tx.ingestCandidate.findUniqueOrThrow({
          where: { id },
          include: {
            procurementSource: true,
            assets: true,
          },
        });
        const ref = input.itemRef.trim();
        let target = null;
        if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(ref))
          target = await tx.item.findUnique({ where: { id: ref } });
        else if (/^TM[0-9]{6,}$/i.test(ref))
          target = await tx.item.findUnique({
            where: { serial: Number(ref.slice(2)) },
          });
        else {
          const alias = await tx.itemAlias.findUnique({
            where: { code: ref.toUpperCase() },
            include: { item: true },
          });
          target = alias?.item ?? null;
        }
        if (!target || target.deletedAt || target.dataMode !== "BUSINESS")
          throw new Fault("ITEM_NOT_FOUND", "没有找到可关联的正式TM商品", 404);
        await lock(tx, "item:" + target.id);
        if (current.decision === "CONFIRMED" && current.itemId === target.id)
          return {
            id,
            itemId: target.id,
            code: tm(target.serial),
            existing: true,
          };
        if (current.decision === "CONFIRMED")
          throw new Fault(
            "CANDIDATE_ALREADY_CONFIRMED",
            "该候选已经归入另一件TM",
            409,
          );
        if (current.decision === "EXCLUDED")
          throw new Fault(
            "CANDIDATE_EXCLUDED",
            "已排除候选需先重新核对再关联TM",
            409,
          );
        if (current.version !== input.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "候选已被其他人修改，请重新读取后再关联",
            409,
          );
        const { source } = await this.ensureSourceInTx(tx, actor, id);
        const existingSource = await tx.itemSourceLink.findFirst({
          where: { sourceId: source.id },
        });
        if (existingSource && existingSource.itemId !== target.id)
          throw new Fault(
            "SOURCE_ALREADY_LINKED",
            "这条来源证据已经归入另一件TM",
            409,
          );
        await tx.itemSourceLink.upsert({
          where: {
            itemId_sourceId: { itemId: target.id, sourceId: source.id },
          },
          create: {
            itemId: target.id,
            sourceId: source.id,
            kind: current.purchaseLineId ? "ACQUISITION" : "REFERENCE",
            linkedBy: actor.id,
            note: input.note,
          },
          update: {},
        });
        if (current.purchaseLineId) {
          await lock(tx, "purchase-line:" + current.purchaseLineId);
          const linked = await tx.itemPurchaseLink.findUnique({
            where: { purchaseLineId: current.purchaseLineId },
          });
          if (linked && linked.itemId !== target.id)
            throw new Fault(
              "PURCHASE_LINE_ALREADY_LINKED",
              "该采购订单行已经关联另一件TM",
              409,
            );
          if (!linked)
            await tx.itemPurchaseLink.create({
              data: {
                purchaseLineId: current.purchaseLineId,
                itemId: target.id,
                linkedBy: actor.id,
                note: input.note,
              },
            });
          await tx.purchaseLine.update({
            where: { id: current.purchaseLineId },
            data: {
              businessDecision: "INCLUDE",
              possession: input.possession,
              reviewNote: input.note,
              version: { increment: 1 },
            },
          });
        }
        const existingShas = new Set(
          (
            await tx.asset.findMany({
              where: { itemId: target.id, archived: false },
              select: { sha256: true },
            })
          ).map((a) => a.sha256),
        );
        let attachedAssets = 0,
          duplicateAssets = 0;
        const last = await tx.asset.aggregate({
          where: { itemId: target.id },
          _max: { position: true },
        });
        let position = (last._max.position ?? -1) + 1;
        for (const a of current.assets) {
          if (a.assetId) {
            const asset = await tx.asset.findUniqueOrThrow({
              where: { id: a.assetId },
            });
            if (asset.itemId !== target.id)
              throw new Fault(
                "CANDIDATE_ASSET_CONFLICT",
                "候选图片已经属于另一件商品",
                409,
              );
            continue;
          }
          if (existingShas.has(a.sha256)) {
            duplicateAssets++;
            continue;
          }
          const asset = await tx.asset.create({
            data: {
              itemId: target.id,
              objectKey: a.objectKey,
              originalName: a.originalName,
              sha256: a.sha256,
              mime: a.mime,
              size: a.size,
              role: "REFERENCE",
              origin: "REFERENCE",
              rights: "INTERNAL",
              verified: false,
              sourceNote: `${current.procurementSource.name} · Agent关联已有TM的来源图片`,
              position: position++,
            },
          });
          await tx.ingestCandidateAsset.update({
            where: { id: a.id },
            data: { assetId: asset.id },
          });
          existingShas.add(a.sha256);
          attachedAssets++;
        }
        const updated = await tx.ingestCandidate.update({
          where: { id },
          data: {
            decision: "CONFIRMED",
            possession: input.possession,
            itemId: target.id,
            confirmedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await audit(tx, actor.id, "INGEST_CANDIDATE_LINKED_ITEM", target.id, {
          candidateId: id,
          sourceId: source.id,
          attachedAssets,
          duplicateAssets,
          note: input.note,
        });
        return {
          id,
          itemId: target.id,
          code: tm(target.serial),
          version: updated.version,
          existing: false,
          attachedAssets,
          duplicateAssets,
        };
      },
    );
  }

  reviewCandidate(
    actor: Actor,
    key: unknown,
    id: string,
    input: {
      version: number;
      possession: "UNKNOWN" | "IN_HAND" | "NOT_IN_HAND";
      decision: "PENDING" | "EXCLUDED";
      title?: string;
      category?: "CLOTHING" | "BAG" | "SHOES" | "ACCESSORY" | "OTHER";
      brandEntryId?: string | null;
      material?: string;
      color?: string;
      sizeLabel?: string;
      measurements?: string;
      descriptionZh?: string;
      note: string;
    },
  ) {
    return this.commands.run(
      actor.id,
      "ingest.candidate.review",
      key,
      { id, ...input },
      async (tx) => {
        await lock(tx, "ingest-candidate:" + id);
        const c = await tx.ingestCandidate.findUniqueOrThrow({ where: { id } });
        if (c.decision === "CONFIRMED")
          throw new Fault(
            "CANDIDATE_ALREADY_CONFIRMED",
            "该候选已经生成TM，不能再改候选字段",
            409,
          );
        if (c.version !== input.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "候选已被其他人修改，请重新读取后再处理",
            409,
          );
        const proposal =
          c.proposal &&
          typeof c.proposal === "object" &&
          !Array.isArray(c.proposal)
            ? { ...(c.proposal as Record<string, unknown>) }
            : {};
        if (input.title !== undefined) proposal.title = input.title;
        if (input.category !== undefined) proposal.category = input.category;
        const facts = { ...record(proposal.facts) };
        for (const key of [
          "material",
          "color",
          "sizeLabel",
          "measurements",
          "descriptionZh",
        ] as const)
          if (input[key] !== undefined) facts[key] = input[key];
        proposal.facts = facts;
        if (input.brandEntryId !== undefined) {
          if (input.brandEntryId === null) {
            proposal.brandEntryId = null;
            proposal.brandLabel = "";
          } else {
            const e = await tx.dictionaryEntry.findUnique({
              where: { id: input.brandEntryId },
            });
            if (!e || e.kind !== "BRAND" || !e.active)
              throw new Fault(
                "BRAND_OPTION_INVALID",
                "品牌选项不存在或已停用",
                400,
              );
            proposal.brandEntryId = e.id;
            proposal.brandLabel = e.label;
          }
        }
        const row = await tx.ingestCandidate.update({
          where: { id },
          data: {
            proposal: json(proposal),
            possession: input.possession,
            decision: input.decision,
            version: { increment: 1 },
          },
        });
        if (c.purchaseLineId) {
          await lock(tx, "purchase-line:" + c.purchaseLineId);
          await tx.purchaseLine.update({
            where: { id: c.purchaseLineId },
            data: {
              businessDecision:
                input.decision === "EXCLUDED" ? "EXCLUDE" : "UNDECIDED",
              possession: input.possession,
              reviewNote: input.note,
              version: { increment: 1 },
            },
          });
        }
        await audit(tx, actor.id, "INGEST_CANDIDATE_REVIEWED", id, {
          before: { possession: c.possession, decision: c.decision },
          after: { possession: row.possession, decision: row.decision },
          note: input.note,
        });
        return {
          id,
          version: row.version,
          possession: row.possession,
          decision: row.decision,
        };
      },
    );
  }

  confirmCandidate(
    actor: Actor,
    key: unknown,
    id: string,
    input: {
      version: number;
      possession: "IN_HAND" | "NOT_IN_HAND";
      status: "AVAILABLE" | "PAUSED";
      duplicateOverride?: boolean;
      acceptIncomplete?: boolean;
      note: string;
    },
  ) {
    return this.commands.run(
      actor.id,
      "ingest.candidate.confirm",
      key,
      { id, ...input },
      async (tx) => {
        await lock(tx, "ingest-candidate:" + id);
        const current = await tx.ingestCandidate.findUniqueOrThrow({
          where: { id },
          include: {
            procurementSource: { include: { supplier: true } },
            batch: true,
            assets: true,
          },
        });
        if (current.decision === "CONFIRMED" && current.itemId) {
          const item = await tx.item.findUniqueOrThrow({
            where: { id: current.itemId },
          });
          return {
            id: current.id,
            itemId: item.id,
            code: `TM${String(item.serial).padStart(6, "0")}`,
            existing: true,
          };
        }
        if (current.decision === "EXCLUDED")
          throw new Fault(
            "CANDIDATE_EXCLUDED",
            "已排除候选不能生成TM；如需恢复请先重新核对",
            409,
          );
        if (current.version !== input.version)
          throw new Fault(
            "VERSION_CONFLICT",
            "候选已被其他人修改，请重新读取后再确认",
            409,
          );
        const integrity = await this.captureReport(current);
        if (integrity.blockers.length)
          throw new Fault(
            "CAPTURE_INCOMPLETE",
            integrity.blockers.join("；"),
            409,
          );
        if (
          record(current.sourceFacts).capture &&
          current.batch.status !== "SEALED"
        )
          throw new Fault(
            "CAPTURE_BATCH_OPEN",
            "采集批次尚未封存，请先完成资料核对",
            409,
          );
        if (
          integrity.state === "GAPS" &&
          (!input.acceptIncomplete || input.note.trim().length < 3)
        )
          throw new Fault(
            "CAPTURE_GAPS_ACK_REQUIRED",
            "来源资料有缺失，请单件核对并记录接受缺失的依据",
            409,
          );
        const supplierHeld = !!current.procurementSource.supplierId;
        if (!supplierHeld && input.possession !== "IN_HAND")
          throw new Fault(
            "POSSESSION_REQUIRED",
            "采购类候选只有确认实物在手后才能生成正式TM",
            400,
          );
        if (!input.duplicateOverride && current.assets.length) {
          const duplicate = await tx.asset.findFirst({
            where: {
              sha256: { in: [...new Set(current.assets.map((a) => a.sha256))] },
              item: { deletedAt: null, dataMode: "BUSINESS" },
            },
            include: { item: { select: { serial: true, title: true } } },
          });
          if (duplicate)
            throw new Fault(
              "POSSIBLE_DUPLICATE_ITEM",
              `来源图片与 ${tm(duplicate.item.serial)} ${duplicate.item.title} 完全相同，请先核对并关联已有TM；如确认是另一件实物，可单件明确覆盖后新建`,
              409,
            );
        }
        const proposal =
          current.proposal &&
          typeof current.proposal === "object" &&
          !Array.isArray(current.proposal)
            ? (current.proposal as Record<string, unknown>)
            : {};
        const title =
          typeof proposal.title === "string" && proposal.title.trim()
            ? proposal.title.trim()
            : current.titleRaw;
        const category = [
          "CLOTHING",
          "BAG",
          "SHOES",
          "ACCESSORY",
          "OTHER",
        ].includes(String(proposal.category))
          ? (String(proposal.category) as NewItemInput["category"])
          : "OTHER";
        const brandEntryId =
          typeof proposal.brandEntryId === "string"
            ? proposal.brandEntryId
            : null;
        const brandLabel =
          typeof proposal.brandLabel === "string" ? proposal.brandLabel : "";
        const { source } = await this.ensureSourceInTx(tx, actor, id);
        const facts = this.itemFacts(
          current.sourceFacts,
          current.procurementSource.name,
          current.conditionRaw,
          current.brandRaw,
          proposal,
        );
        const raw: Record<string, unknown> = {
          title,
          brand: brandEntryId ? brandLabel : "",
          category,
          ownership: supplierHeld ? "SUPPLIER" : "OWN",
          location: supplierHeld
            ? current.procurementSource.supplier?.name ||
              current.procurementSource.name
            : "",
          sourceId: source.id,
          facts,
          currency: "CNY",
          dataMode: "BUSINESS",
        };
        if (brandEntryId) raw.dictionary = { brand: brandEntryId };
        const itemInput = newItem.parse(raw);
        const created = await createItemInTx(tx, actor, itemInput);
        if (!("existing" in created) && input.status === "PAUSED")
          await tx.item.update({
            where: { id: created.id },
            data: { status: "PAUSED" },
          });
        const last = await tx.asset.aggregate({
          where: { itemId: created.id },
          _max: { position: true },
        });
        let position = (last._max.position ?? -1) + 1;
        for (const a of current.assets) {
          if (a.assetId) continue;
          let asset = await tx.asset.findUnique({
            where: { objectKey: a.objectKey },
          });
          if (!asset) {
            asset = await tx.asset.create({
              data: {
                itemId: created.id,
                objectKey: a.objectKey,
                originalName: a.originalName,
                sha256: a.sha256,
                mime: a.mime,
                size: a.size,
                role: "REFERENCE",
                origin: "REFERENCE",
                rights: "INTERNAL",
                verified: false,
                sourceNote: `${current.procurementSource.name} · Agent导入来源图片`,
                position: position++,
              },
            });
          }
          if (asset.itemId !== created.id)
            throw new Fault(
              "CANDIDATE_ASSET_CONFLICT",
              "候选图片已经属于另一件商品，请人工核对",
              409,
            );
          await tx.ingestCandidateAsset.update({
            where: { id: a.id },
            data: { assetId: asset.id },
          });
        }
        if (current.purchaseLineId) {
          await lock(tx, "purchase-line:" + current.purchaseLineId);
          await tx.purchaseLine.update({
            where: { id: current.purchaseLineId },
            data: {
              businessDecision: "INCLUDE",
              possession: input.possession,
              reviewNote: input.note,
              version: { increment: 1 },
            },
          });
        }
        const updated = await tx.ingestCandidate.update({
          where: { id },
          data: {
            decision: "CONFIRMED",
            possession: input.possession,
            itemId: created.id,
            confirmedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await audit(tx, actor.id, "INGEST_CANDIDATE_CONFIRMED", id, {
          itemId: created.id,
          code: created.code,
          sourceId: source.id,
          assetCount: current.assets.length,
          duplicateOverride: input.duplicateOverride === true,
          acceptIncomplete: input.acceptIncomplete === true,
          acceptedAgentProposalPaths: Array.isArray(proposal.agentFields)
            ? proposal.agentFields
                .map((field) => record(field).path)
                .filter((path): path is string => typeof path === "string")
            : [],
          integrity,
          note: input.note,
        });
        return {
          id,
          itemId: created.id,
          code: created.code,
          version: updated.version,
          existing: "existing" in created,
        };
      },
    );
  }
  createMachineBatch(
    session: MachineSession,
    key: unknown,
    input: {
      externalBatchKey: string;
      agentName: string;
      agentVersion: string;
      kind: string;
      rawManifest: Record<string, unknown>;
    },
  ) {
    return this.machineRun(session, "batch.create", key, input, async (tx) => {
      await lock(
        tx,
        `ingest-batch:${session.procurementSourceId}:${input.externalBatchKey}`,
      );
      const source = await tx.procurementSource.findUnique({
        where: { id: session.procurementSourceId },
        select: { code: true },
      });
      if (!source)
        throw new Fault("INGEST_SOURCE_UNAVAILABLE", "导入来源不存在", 404);
      const old = await tx.ingestBatch.findUnique({
        where: {
          procurementSourceId_externalBatchKey: {
            procurementSourceId: session.procurementSourceId,
            externalBatchKey: input.externalBatchKey,
          },
        },
      });
      if (old) {
        if (hash(old.rawManifest) !== hash(input.rawManifest))
          throw new Fault(
            "INGEST_MANIFEST_CONFLICT",
            "相同批次键对应不同清单，请使用新的批次键",
            409,
          );
        return { id: old.id, status: old.status, existing: true };
      }
      assertNewMachineBatchManifest(
        input.rawManifest,
        profileForSourceCode(source.code),
      );
      const row = await tx.ingestBatch.create({
        data: {
          sessionId: session.id,
          procurementSourceId: session.procurementSourceId,
          externalBatchKey: input.externalBatchKey,
          agentName: input.agentName,
          agentVersion: input.agentVersion,
          kind: input.kind,
          rawManifest: json(input.rawManifest),
        },
      });
      await audit(tx, session.createdBy, "INGEST_BATCH_CREATED", row.id, {
        sessionId: session.id,
        agentName: input.agentName,
        kind: input.kind,
      });
      return { id: row.id, status: row.status, existing: false };
    });
  }

  upsertMachineCandidates(
    session: MachineSession,
    key: unknown,
    batchId: string,
    inputs: CandidateInput[],
  ) {
    return this.machineRun(
      session,
      "candidate.upsert",
      key,
      { batchId, candidates: inputs },
      async (tx) => {
        await lock(tx, "ingest-batch:" + batchId);
        const batch = await tx.ingestBatch.findUnique({
          where: { id: batchId },
          include: { procurementSource: { select: { defaultCurrency: true } } },
        });
        if (!batch || batch.procurementSourceId !== session.procurementSourceId)
          throw new Fault(
            "INGEST_BATCH_NOT_FOUND",
            "导入批次不存在或不属于此来源",
            404,
          );
        if (batch.status !== "OPEN")
          throw new Fault(
            "INGEST_BATCH_SEALED",
            "导入批次已封存，不能继续写入",
            409,
          );
        const rows = [] as {
          id: string;
          version: number;
          unchanged: boolean;
        }[];
        for (const input of inputs)
          rows.push(
            await this.upsertCandidate(
              tx,
              batch.id,
              session.procurementSourceId,
              input,
              batch.procurementSource.defaultCurrency,
            ),
          );
        await audit(
          tx,
          session.createdBy,
          "INGEST_CANDIDATES_UPSERTED",
          batch.id,
          { count: inputs.length, agentSessionId: session.id },
        );
        return { batchId: batch.id, rows };
      },
    );
  }

  sealMachineBatch(session: MachineSession, key: unknown, batchId: string) {
    return this.machineRun(
      session,
      "batch.seal",
      key,
      { batchId },
      async (tx) => {
        await lock(tx, "ingest-batch:" + batchId);
        const batch = await tx.ingestBatch.findUnique({
          where: { id: batchId },
        });
        if (!batch || batch.procurementSourceId !== session.procurementSourceId)
          throw new Fault(
            "INGEST_BATCH_NOT_FOUND",
            "导入批次不存在或不属于此来源",
            404,
          );
        if (batch.status === "SEALED")
          return { id: batch.id, status: batch.status, existing: true };
        if (batch.status !== "OPEN")
          throw new Fault("INGEST_BATCH_STATE", "当前批次状态不可封存", 409);
        const report = await this.batchReport(tx, batchId);
        if (report.blockers.length)
          throw new Fault(
            "CAPTURE_INCOMPLETE",
            report.blockers.join("；"),
            409,
          );
        const row = await tx.ingestBatch.update({
          where: { id: batch.id },
          data: { status: "SEALED", sealedAt: new Date() },
        });
        const count = await tx.ingestCandidate.count({
          where: { batchId: batch.id },
        });
        await audit(tx, session.createdBy, "INGEST_BATCH_SEALED", batch.id, {
          count,
          integrity: report,
          agentSessionId: session.id,
        });
        return {
          id: row.id,
          status: row.status,
          candidateCount: count,
          integrity: report,
        };
      },
    );
  }
  registerCandidateAsset(
    session: MachineSession,
    key: unknown,
    candidateId: string,
    prepared: PreparedImage,
    meta: { sourceUrl: string; roleHint: string },
  ) {
    const stored = prepared.metadata;
    return imageCommand(this.db, prepared, (persist) =>
      this.machineRun(
        session,
        "candidate.asset",
        key,
        {
          candidateId,
          sha256: stored.sha256,
          sourceUrl: meta.sourceUrl,
          roleHint: meta.roleHint,
        },
        async (tx) => {
          const initial = await tx.ingestCandidate.findUnique({
            where: { id: candidateId },
          });
          if (initial) await lock(tx, "ingest-batch:" + initial.batchId);
          await lock(tx, "ingest-candidate:" + candidateId);
          const candidate = await tx.ingestCandidate.findUnique({
            where: { id: candidateId },
            include: { batch: true },
          });
          if (
            !candidate ||
            candidate.procurementSourceId !== session.procurementSourceId
          )
            throw new Fault(
              "INGEST_CANDIDATE_NOT_FOUND",
              "候选不存在或不属于此来源",
              404,
            );
          if (initial?.batchId !== candidate.batchId)
            throw new Fault(
              "VERSION_CONFLICT",
              "候选所属批次已变化，请重新读取",
              409,
            );
          if (candidate.batch.status !== "OPEN")
            throw new Fault(
              "INGEST_BATCH_SEALED",
              "批次已封存，不能继续上传图片",
              409,
            );
          if (!["PENDING", "CONFIRMED"].includes(candidate.decision))
            throw new Fault(
              "INGEST_CANDIDATE_CLOSED",
              "候选已排除，不能继续上传图片",
              409,
            );
          const old = await tx.ingestCandidateAsset.findUnique({
            where: {
              candidateId_sha256: { candidateId, sha256: stored.sha256 },
            },
          });
          if (old)
            return { id: old.id, existing: true, objectKey: old.objectKey };
          const { objectKey } = await persist(tx);
          const row = await tx.ingestCandidateAsset.create({
            data: {
              candidateId,
              objectKey,
              originalName: stored.originalName,
              sha256: stored.sha256,
              mime: stored.mime,
              size: stored.size,
              sourceUrl: meta.sourceUrl,
              roleHint: meta.roleHint,
            },
          });
          await audit(
            tx,
            session.createdBy,
            "INGEST_CANDIDATE_ASSET_ADDED",
            candidateId,
            { assetId: row.id, sha256: row.sha256, agentSessionId: session.id },
          );
          return { id: row.id, existing: false, objectKey: row.objectKey };
        },
      ),
    );
  }

  async machineBatchStatus(session: MachineSession, batchId: string) {
    const batch = await this.db.ingestBatch.findUnique({
      where: { id: batchId },
      include: { _count: { select: { candidates: true } } },
    });
    if (!batch || batch.procurementSourceId !== session.procurementSourceId)
      throw new Fault(
        "INGEST_BATCH_NOT_FOUND",
        "导入批次不存在或不属于此来源",
        404,
      );
    return {
      id: batch.id,
      status: batch.status,
      candidateCount: batch._count.candidates,
      sealedAt: batch.sealedAt,
      integrity: await this.batchReport(this.db, batchId),
    };
  }
  async captureReport(candidate: {
    sourceFacts: unknown;
    assets: { objectKey: string; sha256: string }[];
    batch?: { rawManifest: unknown };
    [key: string]: unknown;
  }) {
    const assets = record(candidate.sourceFacts).capture
      ? await Promise.all(
          candidate.assets.map(async (a) => {
            try {
              const m = await sharp(assetPath(a.objectKey)).metadata();
              return { sha256: a.sha256, width: m.width, height: m.height };
            } catch {
              return { sha256: a.sha256, missing: true };
            }
          }),
        )
      : candidate.assets;
    const manifest = batchManifest.safeParse(candidate.batch?.rawManifest);
    return inspectCapture(
      candidate,
      assets,
      manifest.success ? effectiveRequiredFields(manifest.data) : [],
    );
  }
  async batchReport(tx: Tx | PrismaService, id: string) {
    const sealed = await tx.ingestBatch.findUniqueOrThrow({ where: { id } });
    if (sealed.status === "SEALED") {
      const evidence = await tx.audit.findFirst({
        where: { action: "INGEST_BATCH_SEALED", resourceId: id },
        orderBy: { createdAt: "desc" },
      });
      const report = record(evidence?.detail).integrity;
      if (report)
        return report as {
          state: string;
          expectedCount: number | null;
          receivedCount: number;
          blockers: string[];
          rows: ({
            id: string;
            title: string;
            externalKey: string;
          } & Integrity)[];
        };
    }
    const batch = await tx.ingestBatch.findUniqueOrThrow({
      where: { id },
      include: { candidates: { include: { assets: true } } },
    });
    const manifest = batchManifest.parse(batch.rawManifest),
      expected = manifest.expectedCandidateKeys;
    const keys = new Set(batch.candidates.map((c) => c.externalKey));
    const blockers = (expected || [])
      .filter((k) => !keys.has(k))
      .map((k) => `缺少商品：${k}`);
    if (expected)
      for (const k of keys)
        if (!expected.includes(k)) blockers.push(`清单外商品：${k}`);
    const rows = [];
    for (const c of batch.candidates) {
      const integrity = await this.captureReport({ ...c, batch });
      if (expected && integrity.state === "UNVERIFIED")
        blockers.push(`${c.externalKey}缺少采集检查清单`);
      blockers.push(...integrity.blockers.map((v) => `${c.externalKey}：${v}`));
      rows.push({
        id: c.id,
        externalKey: c.externalKey,
        title: c.titleRaw,
        ...integrity,
      });
    }
    return {
      state:
        blockers.length || rows.some((r) => r.state === "GAPS")
          ? "GAPS"
          : !expected || rows.some((r) => r.state === "UNVERIFIED")
            ? "UNVERIFIED"
            : "COMPLETE",
      expectedCount: expected?.length ?? null,
      receivedCount: rows.length,
      blockers,
      rows,
    };
  }
  revokeSession(actor: Actor, key: unknown, id: string, reason: string) {
    return this.commands.run(
      actor.id,
      "ingest.session.revoke",
      key,
      { id, reason },
      async (tx) => {
        const row = await tx.ingestSession.findUnique({ where: { id } });
        if (!row)
          throw new Fault("INGEST_SESSION_NOT_FOUND", "导入会话不存在", 404);
        if (row.revokedAt) return { id, existing: true };
        await tx.ingestSession.update({
          where: { id },
          data: { revokedAt: new Date() },
        });
        await audit(tx, actor.id, "INGEST_SESSION_REVOKED", id, { reason });
        return { id, existing: false };
      },
    );
  }
}
