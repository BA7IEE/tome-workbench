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
    sourceCurrentPrice: amount.nullable().optional().default(null),
    sourceEstimatedRetail: amount.nullable().optional().default(null),
    sourceFacts: z
      .object({ capture: captureEvidence.optional() })
      .passthrough()
      .default({}),
    rawPayload: z.record(z.unknown()).default({}),
  })
  .strict();

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
    status: z.enum(["AVAILABLE", "PAUSED"]).default("PAUSED"),
    duplicateOverride: z.boolean().default(false),
    acceptIncomplete: z.boolean().default(false),
    note: safeText(2000).default("批量确认导入"),
  })
  .strict();

export const candidateBulkInput = z
  .object({
    ids: z.array(uuid).min(1).max(100),
    versions: z.record(uuid, z.number().int().positive()).optional(),
    possession: z.enum(["IN_HAND", "NOT_IN_HAND"]),
    // Bulk adoption is intentionally conservative. Existing clients may still
    // submit AVAILABLE, but the parsed bulk command starts newly created TM
    // items paused so the operator explicitly decides when they are sale-ready.
    status: z.enum(["AVAILABLE", "PAUSED"]).default("PAUSED"),
  })
  .strict()
  .transform((value) => ({ ...value, status: "PAUSED" as const }));

export const candidateBulkExcludeInput = z
  .object({
    ids: z.array(uuid).min(1).max(100),
    versions: z.record(uuid, z.number().int().positive()).optional(),
    reason: safeText(2000).min(3),
  })
  .strict();
