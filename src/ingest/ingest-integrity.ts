import { z } from "zod";
import { safeText } from "../common/domain";

const httpUrl = z
  .string()
  .url()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), "只允许HTTP来源地址");
export const captureEvidence = z
  .object({
    pageUrl: httpUrl.optional(),
    fileEvidence: z
      .object({
        name: safeText(300).min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        row: safeText(160).min(1),
      })
      .strict()
      .optional(),
    capturedAt: z.string().datetime(),
    fields: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(/^(?:[a-zA-Z][a-zA-Z0-9]*)(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/)
              .max(160),
            label: safeText(100).min(1),
            status: z.enum(["CAPTURED", "UNAVAILABLE"]),
            reason: safeText(1000).default(""),
          })
          .strict(),
      )
      .max(100),
    images: z
      .array(
        z
          .object({
            sourceUrl: httpUrl.optional(),
            sourceFile: safeText(300).min(1).optional(),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            width: z.number().int().positive().max(40000).optional(),
            height: z.number().int().positive().max(40000).optional(),
            quality: z.enum([
              "ORIGINAL",
              "LARGEST_AVAILABLE",
              "THUMBNAIL",
              "UNAVAILABLE",
            ]),
            reason: safeText(1000).default(""),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!!v.pageUrl === !!v.fileEvidence)
      ctx.addIssue({
        code: "custom",
        message: "采集依据必须明确选择网页地址或文件名、校验值和记录位置",
      });
    if (new Set(v.fields.map((f) => f.path)).size !== v.fields.length)
      ctx.addIssue({ code: "custom", message: "字段检查项不能重复" });
    if (
      new Set(v.images.map((i) => i.sourceUrl || `file:${i.sourceFile}`))
        .size !== v.images.length
    )
      ctx.addIssue({ code: "custom", message: "来源图地址不能重复" });
    for (const f of v.fields)
      if (f.status === "UNAVAILABLE" && !f.reason.trim())
        ctx.addIssue({
          code: "custom",
          message: "来源字段无法取得时必须记录原因",
        });
    for (const i of v.images) {
      if (!!i.sourceUrl === !!i.sourceFile)
        ctx.addIssue({
          code: "custom",
          message: "每张图片必须明确提供来源网址或原文件名称",
        });
      if (i.quality !== "UNAVAILABLE" && (!i.sha256 || !i.width || !i.height))
        ctx.addIssue({
          code: "custom",
          message: "可取得的图片必须提供原文件哈希及尺寸",
        });
      if (i.quality !== "ORIGINAL" && !i.reason.trim())
        ctx.addIssue({ code: "custom", message: "未取得原图时必须记录原因" });
    }
  });
export const batchManifest = z
  .object({
    protocolVersion: z
      .string()
      .regex(/^\d+\.\d+(?:\.\d+)?$/)
      .max(20)
      .optional(),
    skillVersion: z
      .string()
      .regex(/^tome-ingest\/\d+\.\d+(?:\.\d+)?$/)
      .max(80)
      .optional(),
    profile: z
      .string()
      .regex(/^[A-Z][A-Z0-9_-]*(?:\/[0-9]+\.[0-9]+(?:\.[0-9]+)?)?$/)
      .max(120)
      .optional(),
    expectedCandidateKeys: z
      .array(safeText(240).min(1))
      .min(1)
      .max(20000)
      .optional(),
    requiredFields: z.array(safeText(160).min(1)).max(100).optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (
      v.expectedCandidateKeys &&
      new Set(v.expectedCandidateKeys).size !== v.expectedCandidateKeys.length
    )
      ctx.addIssue({ code: "custom", message: "预期商品键不能重复" });
  });
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export type IntegrityAsset = {
  sha256: string;
  width?: number;
  height?: number;
  missing?: boolean;
};
export type Integrity = {
  state: "COMPLETE" | "GAPS" | "UNVERIFIED";
  issues: string[];
  blockers: string[];
  expectedImages: number | null;
  storedImages: number;
};
export function inspectCapture(
  candidate: Record<string, unknown>,
  assets: IntegrityAsset[],
  requiredFields: string[] = [],
): Integrity {
  const facts = record(candidate.sourceFacts),
    parsed = captureEvidence.safeParse(facts.capture);
  const result: Integrity = {
    state: "UNVERIFIED",
    issues: [],
    blockers: [],
    expectedImages: null,
    storedImages: assets.length,
  };
  if (!parsed.success) {
    result.issues.push("尚未提交完整性检查清单，不能证明资料已收齐");
    if (facts.capture !== undefined || requiredFields.length)
      result.blockers.push("缺少有效的采集检查清单");
    return result;
  }
  const c = parsed.data;
  result.expectedImages = c.images.length;
  const readPath = (path: string) =>
    path
      .split(".")
      .reduce<unknown>(
        (v, k) => (Object.hasOwn(record(v), k) ? record(v)[k] : undefined),
        candidate,
      );
  for (const path of requiredFields)
    if (!c.fields.some((f) => f.path === path))
      result.blockers.push(`缺少字段检查：${path}`);
  for (const f of c.fields) {
    if (f.status === "UNAVAILABLE")
      result.issues.push(`${f.label}：${f.reason}`);
    else {
      const value = readPath(f.path);
      if (
        value == null ||
        value === "" ||
        (Array.isArray(value) && !value.length) ||
        (typeof value === "object" &&
          !Array.isArray(value) &&
          !Object.keys(record(value)).length)
      )
        result.blockers.push(`${f.label}标记已采集，但没有提交内容`);
    }
  }
  if (!c.images.length) result.issues.push("来源图册为0张，请人工核对");
  for (const [n, i] of c.images.entries()) {
    if (i.quality === "UNAVAILABLE") {
      result.issues.push(`第${n + 1}张图片未取得：${i.reason}`);
      continue;
    }
    const a = assets.find((a) => a.sha256 === i.sha256);
    if (!a || a.missing) result.blockers.push(`第${n + 1}张图片原文件尚未保存`);
    else if (
      (a.width !== undefined && a.width !== i.width) ||
      (a.height !== undefined && a.height !== i.height)
    )
      result.blockers.push(`第${n + 1}张图片实际尺寸与清单不一致`);
    if (i.quality === "THUMBNAIL")
      result.issues.push(`第${n + 1}张只有缩略图：${i.reason}`);
  }
  result.issues.push(...result.blockers);
  result.state = result.issues.length ? "GAPS" : "COMPLETE";
  return result;
}
