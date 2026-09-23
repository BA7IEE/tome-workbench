import { z } from "zod";
import { amount, currency, safeText, uuid } from "../common/domain";
import { batchManifest, captureEvidence } from "./ingest-integrity";
import { Fault } from "../common/errors";

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

export const sourceCorrectionClearField = z.enum([
  "categoryRaw",
  "conditionRaw",
  "sourceCurrentPrice",
  "sourceFacts.material",
  "sourceFacts.measurements",
  "sourceFacts.productUrl",
  "sourceFacts.highResolutionCapture",
]);

export const sourceCorrectionInput = z
  .object({
    clearFields: z
      .array(sourceCorrectionClearField)
      .max(7)
      .refine((fields) => new Set(fields).size === fields.length, {
        message: "来源纠错字段不能重复",
      })
      .default([]),
    retireAssetSha256: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(100)
      .refine((hashes) => new Set(hashes).size === hashes.length, {
        message: "来源纠错图片不能重复",
      })
      .default([]),
    invalidateAgentProposal: z.boolean().default(false),
    reason: safeText(1000).min(3),
  })
  .strict()
  .superRefine((correction, ctx) => {
    if (
      !correction.clearFields.length &&
      !correction.retireAssetSha256.length &&
      !correction.invalidateAgentProposal
    )
      ctx.addIssue({
        code: "custom",
        message: "来源纠错至少要清空字段、撤下错误图片或撤销 Agent 建议之一",
      });
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

const trrOrderDate = z
  .object({
    // Preserve the source wording next to the normalized, date-only value so
    // future review does not have to reconstruct a date from a timestamp.
    // Historical TRR evidence can also contain payments, adjustments and
    // other order facts here. Those facts are not date fields, but must remain
    // intact when a 1.4 backfill adds the three structured date fields.
    orderDateRaw: safeText(240).min(1),
    orderedAt: z.string().trim().min(1),
    datePrecision: z.enum(["DAY", "MONTH", "YEAR"]),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const patterns = {
      DAY: /^(\d{4})-(\d{2})-(\d{2})$/,
      MONTH: /^(\d{4})-(\d{2})$/,
      YEAR: /^(\d{4})$/,
    } as const;
    const match = patterns[value.datePrecision].exec(value.orderedAt);
    if (!match) {
      ctx.addIssue({
        code: "custom",
        path: ["orderedAt"],
        message: `${value.datePrecision} 精度的购买日期必须是日期文本，不能填入时分秒`,
      });
      return;
    }
    const year = Number(match[1]);
    if (year < 1000 || year > 9999) {
      ctx.addIssue({
        code: "custom",
        path: ["orderedAt"],
        message: "购买日期年份无效",
      });
      return;
    }
    if (value.datePrecision === "YEAR") return;
    const month = Number(match[2]);
    if (month < 1 || month > 12) {
      ctx.addIssue({
        code: "custom",
        path: ["orderedAt"],
        message: "购买日期月份无效",
      });
      return;
    }
    if (value.datePrecision === "MONTH") return;
    const day = Number(match[3]);
    if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())
      ctx.addIssue({
        code: "custom",
        path: ["orderedAt"],
        message: "购买日期日数无效",
      });
  });

const trr14SourceFacts = z
  .object({
    sizeLabel: safeText(100).optional(),
    foreignSize: safeText(100).optional(),
    sizeEstimated: z.boolean(),
    order: trrOrderDate.optional(),
    capture: captureEvidence.optional(),
  })
  .passthrough();

type CaptureField = {
  path: string;
  status: "CAPTURED" | "UNAVAILABLE";
  reason: string;
};

function trrCaptureField(
  fields: CaptureField[],
  path: string,
): CaptureField | undefined {
  return fields.find((field) => field.path === path);
}

function requireTrrCapture(
  fields: CaptureField[],
  path: string,
  status: CaptureField["status"],
) {
  const field = trrCaptureField(fields, path);
  if (
    !field ||
    field.status !== status ||
    (status === "UNAVAILABLE" && !field.reason.trim())
  )
    throw new Fault(
      "TRR_SOURCE_FACTS_INVALID",
      status === "CAPTURED"
        ? `${path} 是已取得的 TRR 来源事实，必须在字段清单标为 CAPTURED`
        : `${path} 缺失时必须在字段清单标为 UNAVAILABLE 并写明来源侧原因`,
      400,
    );
}

/**
 * TRR/1.4 is deliberately stricter than the generic sourceFacts envelope.
 * It protects the two facts that are easy to blur in a review: a display size
 * is not a physical tag size, and a date-only source record is not a timestamp.
 */
export function assertTrr14SourceFacts(sourceFacts: Record<string, unknown>) {
  const parsed = trr14SourceFacts.safeParse(sourceFacts);
  if (!parsed.success)
    throw new Fault(
      "TRR_SOURCE_FACTS_INVALID",
      parsed.error.issues.map((issue) => issue.message).join("；"),
      400,
    );
  const facts = parsed.data;
  const fields = (facts.capture?.fields || []) as CaptureField[];
  if (facts.foreignSize)
    requireTrrCapture(fields, "sourceFacts.foreignSize", "CAPTURED");
  else requireTrrCapture(fields, "sourceFacts.foreignSize", "UNAVAILABLE");
  requireTrrCapture(fields, "sourceFacts.sizeEstimated", "CAPTURED");
  if (facts.order) {
    requireTrrCapture(fields, "sourceFacts.order.orderDateRaw", "CAPTURED");
    requireTrrCapture(fields, "sourceFacts.order.orderedAt", "CAPTURED");
    requireTrrCapture(fields, "sourceFacts.order.datePrecision", "CAPTURED");
  } else {
    requireTrrCapture(fields, "sourceFacts.order.orderDateRaw", "UNAVAILABLE");
    requireTrrCapture(fields, "sourceFacts.order.orderedAt", "UNAVAILABLE");
    requireTrrCapture(fields, "sourceFacts.order.datePrecision", "UNAVAILABLE");
  }
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
    sourceCorrection: sourceCorrectionInput.optional(),
    agentProposal: agentProposalInput.optional(),
    rawPayload: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    for (const path of candidate.sourceCorrection?.clearFields || []) {
      if (
        hasEvidenceValue(
          evidenceValue(candidate as Record<string, unknown>, path),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: path.split("."),
          message: `显式清空 ${path} 时该字段必须为空`,
        });
      const check = candidate.sourceFacts.capture?.fields.find(
        (field) => field.path === path,
      );
      if (check?.status !== "UNAVAILABLE" || !check.reason.trim())
        ctx.addIssue({
          code: "custom",
          path: ["sourceFacts", "capture", "fields"],
          message: `显式清空 ${path} 时必须把同路径标记为 UNAVAILABLE 并说明来源侧原因`,
        });
    }
    for (const sha256 of candidate.sourceCorrection?.retireAssetSha256 || [])
      if (
        candidate.sourceFacts.capture?.images.some(
          (image) => image.sha256 === sha256,
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["sourceFacts", "capture", "images"],
          message: "已撤下的错误来源图片不能继续出现在当前图片清单",
        });
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

export const candidateBrandBindInput = z
  .object({
    reason: safeText(1000).min(3),
    rows: z.array(z.object({
      id: uuid,
      version: z.number().int().positive(),
      expectedProcurementSourceId: uuid,
      expectedBrandRaw: safeText(160),
      expectedSuggestedBrand: safeText(160),
      brandEntryId: uuid,
      brandEntryVersion: z.number().int().positive(),
    }).strict()).min(1).max(100).refine(
      rows => new Set(rows.map(row => row.id)).size === rows.length,
      "同一候选不能在同批出现两次",
    ),
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
