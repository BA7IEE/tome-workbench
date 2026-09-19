import { z } from "zod";
import { amount, currency, safeText, uuid } from "../common/domain";
import { batchManifest, captureEvidence } from "./ingest-integrity";

export const ingestSessionInput = z
  .object({
    procurementSourceId: uuid,
    label: safeText(120).min(1),
    ttlMinutes: z.number().int().min(5).max(1440).default(120),
  })
  .strict();

export const ingestBatchInput = z
  .object({
    externalBatchKey: safeText(180).min(1),
    agentName: safeText(120).min(1),
    agentVersion: safeText(80).default(""),
    kind: z
      .enum([
        "ITEM_BATCH",
        "ORDER_HISTORY",
        "SUPPLIER_FEED",
        "OFFLINE_IMPORT",
        "OTHER",
      ])
      .default("ITEM_BATCH"),
    rawManifest: batchManifest.default({}),
  })
  .strict();

export const agentProposalPath = z.enum([
  "title",
  "brand",
  "category",
  "facts.material",
  "facts.color",
  "facts.sizeLabel",
  "facts.measurements",
  "facts.descriptionZh",
]);

const agentProposalField = z
  .object({
    path: agentProposalPath,
    value: safeText(12000).min(1),
    method: z.enum(["EXTRACTED", "NORMALIZED", "TRANSLATED", "INFERRED"]),
    confidence: z.number().min(0).max(1),
    evidencePaths: z.array(safeText(240).min(1)).max(40).default([]),
    evidenceImageSha256: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(40)
      .default([]),
    note: safeText(500).default(""),
  })
  .strict()
  .superRefine((field, ctx) => {
    const maxLength: Record<(typeof field)["path"], number> = {
      title: 500,
      brand: 160,
      category: 20,
      "facts.material": 300,
      "facts.color": 100,
      "facts.sizeLabel": 100,
      "facts.measurements": 1500,
      "facts.descriptionZh": 12000,
    };
    if (Array.from(field.value).length > maxLength[field.path])
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Agent 建议超过目标字段 ${field.path} 的长度限制`,
      });
    if (
      field.path === "category" &&
      !["CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"].includes(field.value)
    )
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "一级品类建议必须使用系统下拉选项值",
      });
    if (!field.evidencePaths.length && !field.evidenceImageSha256.length)
      ctx.addIssue({
        code: "custom",
        message: "每项 Agent 建议至少要引用一个来源字段或来源图片",
      });
    for (const [index, path] of field.evidencePaths.entries())
      if (
        !/^(?:(?:titleRaw|brandRaw|categoryRaw|conditionRaw|statusRaw|sourceItemKey|sourceLineAmount|sourceLineNetAmount|sourceCurrentPrice|sourceEstimatedRetail)$|sourceFacts(?:\.|$)|rawPayload(?:\.|$))/.test(
          path,
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["evidencePaths", index],
          message: "Agent 建议只能引用候选的来源证据路径",
        });
  });

export const agentProposalInput = z
  .object({
    generator: z.enum(["LLM", "RULES", "HYBRID"]),
    model: safeText(160).default(""),
    generatedAt: z.string().datetime(),
    fields: z.array(agentProposalField).min(1).max(20),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    if (proposal.generator !== "RULES" && !proposal.model)
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "LLM 或混合整理必须记录实际模型",
      });
    const paths = proposal.fields.map((field) => field.path);
    if (new Set(paths).size !== paths.length)
      ctx.addIssue({ code: "custom", message: "同一目标字段只能提交一项建议" });
  });

function evidenceValue(candidate: Record<string, unknown>, path: string) {
  let value: unknown = candidate;
  for (const part of path.split(".")) {
    if (
      ["__proto__", "constructor", "prototype"].includes(part) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function hasEvidenceValue(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export const ingestCandidateInput = z
  .object({
    externalKey: safeText(240).min(1),
    sourceItemKey: safeText(160).default(""),
    purchaseLineId: uuid.nullable().optional().default(null),
    titleRaw: safeText(500).min(1),
    brandRaw: safeText(160).default(""),
    categoryRaw: safeText(500).default(""),
    conditionRaw: safeText(160).default(""),
    statusRaw: safeText(160).default(""),
    currency: currency.optional(),
    sourceLineAmount: amount.nullable().optional().default(null),
    sourceLineNetAmount: amount.nullable().optional().default(null),
    sourceCurrentPrice: amount.nullable().optional().default(null),
    sourceEstimatedRetail: amount.nullable().optional().default(null),
    sourceFacts: z
      .object({ capture: captureEvidence.optional() })
      .passthrough()
      .default({}),
    agentProposal: agentProposalInput.optional(),
    rawPayload: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (!candidate.agentProposal) return;
    const declaredHashes = new Set(
      (candidate.sourceFacts.capture?.images || [])
        .map((image) => image.sha256)
        .filter((value): value is string => !!value),
    );
    for (const [fieldIndex, field] of candidate.agentProposal.fields.entries())
      for (const [pathIndex, path] of field.evidencePaths.entries())
        if (
          !hasEvidenceValue(
            evidenceValue(candidate as Record<string, unknown>, path),
          )
        )
          ctx.addIssue({
            code: "custom",
            path: [
              "agentProposal",
              "fields",
              fieldIndex,
              "evidencePaths",
              pathIndex,
            ],
            message: "Agent 建议引用的来源证据路径没有实际值",
          });
    for (const [fieldIndex, field] of candidate.agentProposal.fields.entries())
      for (const [hashIndex, sha256] of field.evidenceImageSha256.entries())
        if (!declaredHashes.has(sha256))
          ctx.addIssue({
            code: "custom",
            path: [
              "agentProposal",
              "fields",
              fieldIndex,
              "evidenceImageSha256",
              hashIndex,
            ],
            message: "Agent 建议引用的图片必须先列入来源图片清单",
          });
  });

export const ingestCandidatesInput = z
  .object({
    candidates: z.array(ingestCandidateInput).min(1).max(200),
  })
  .strict();

export const candidateReviewInput = z
  .object({
    version: z.number().int().positive(),
    possession: z.enum(["UNKNOWN", "IN_HAND", "NOT_IN_HAND"]),
    decision: z.enum(["PENDING", "EXCLUDED"]).default("PENDING"),
    title: z.string().trim().max(500).optional(),
    category: z
      .enum(["CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"])
      .optional(),
    brandEntryId: uuid.nullable().optional(),
    material: safeText(300).optional(),
    color: safeText(100).optional(),
    sizeLabel: safeText(100).optional(),
    measurements: safeText(1500).optional(),
    descriptionZh: safeText(12000).optional(),
    note: safeText(2000).default(""),
  })
  .strict();

export const candidateLinkItemInput = z
  .object({
    version: z.number().int().positive(),
    itemRef: safeText(120).min(1),
    possession: z.enum(["IN_HAND", "NOT_IN_HAND"]).default("IN_HAND"),
    note: safeText(2000).min(3),
  })
  .strict();

export const candidateConfirmInput = z
  .object({
    version: z.number().int().positive(),
    possession: z.enum(["IN_HAND", "NOT_IN_HAND"]),
    status: z.enum(["AVAILABLE", "PAUSED"]).default("AVAILABLE"),
    duplicateOverride: z.boolean().default(false),
    acceptIncomplete: z.boolean().default(false),
    note: safeText(2000).default("批量确认导入"),
  })
  .strict();

export const candidateBulkInput = z
  .object({
    ids: z.array(uuid).min(1).max(100),
    versions: z.record(uuid, z.number().int().positive()).optional(),
    incompleteAcknowledgements: z
      .record(uuid, safeText(2000).min(3))
      .optional(),
    possession: z.enum(["IN_HAND", "NOT_IN_HAND"]),
    // New callers default to PAUSED so a bulk receipt decision does not silently
    // become a sale-readiness decision. Explicit AVAILABLE remains supported for
    // reviewed/import integrations and backwards compatibility.
    status: z.enum(["AVAILABLE", "PAUSED"]).default("PAUSED"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.ids).size !== value.ids.length)
      ctx.addIssue({ code: "custom", message: "不能重复选择同一候选" });
    for (const id of Object.keys(value.incompleteAcknowledgements || {}))
      if (!value.ids.includes(id) || !value.versions?.[id])
        ctx.addIssue({
          code: "custom",
          message: "缺项确认必须对应所选候选及已核对版本",
        });
  });

export const candidateBulkExcludeInput = z
  .object({
    ids: z.array(uuid).min(1).max(100),
    versions: z.record(uuid, z.number().int().positive()).optional(),
    reason: safeText(2000).min(3),
  })
  .strict();
