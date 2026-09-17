import { z } from "zod";
import { Fault } from "./errors";
export const currency = z.enum(["CNY", "USD", "EUR", "HKD", "GBP", "SGD"]); // This release only supports 2-decimal currencies.
export const amount = z.number().int().min(0).max(2000000000).nullable();
export const uuid = z.string().uuid();
export const expectedVersion = z.number().int().positive();
export const safeText = (max = 4000) => z.string().trim().max(max);
const attributeKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/);
function canonicalStyleNumber<T extends string | number | boolean>(
  values: Record<string, T>,
) {
  const { style_number: legacy, ...canonical } = values;
  // `style_number` is readable only for historical facts. Every newly parsed
  // write is stored under the canonical standard extension key instead.
  const styleNumber =
    canonical.styleNumber !== undefined && canonical.styleNumber !== ""
      ? canonical.styleNumber
      : legacy;
  if (styleNumber !== undefined && styleNumber !== "")
    canonical.styleNumber = styleNumber;
  return canonical;
}
const attributeLabels = z
  .record(attributeKey, safeText(100))
  .transform(canonicalStyleNumber);
const attributes = z
  .record(
    attributeKey,
    z.union([safeText(1000), z.number().finite(), z.boolean()]),
  )
  .transform(canonicalStyleNumber);
export const factsSchema = z
  .object({
    material: safeText(300).default(""),
    mainMaterial: safeText(100).default(""),
    conditionGrade: safeText(100).default(""),
    conditionGradeEn: safeText(100).default(""),
    color: safeText(100).default(""),
    sizeLabel: safeText(100).default(""),
    measurements: safeText(1500).default(""),
    measurementSource: safeText(500).default(""),
    condition: safeText(3000).default(""),
    descriptionZh: safeText(12000).default(""),
    descriptionEn: safeText(12000).default(""),
    authentication: z
      .object({
        status: z.enum(["UNKNOWN", "PASSED", "FAILED"]).default("UNKNOWN"),
        evidence: safeText(2000).default(""),
      })
      .strict()
      .default({ status: "UNKNOWN", evidence: "" }),
    research: z
      .array(
        z
          .object({
            claim: safeText(1000),
            evidence: safeText(2000),
            confirmed: z.boolean(),
          })
          .strict(),
      )
      .max(40)
      .default([]),
    attributeLabels: attributeLabels.default({}),
    attributes: attributes.default({}),
  })
  .strict();
export type Facts = z.infer<typeof factsSchema>;
export const factsPatch = factsSchema.partial();
export function tm(serial: number) {
  if (!Number.isSafeInteger(serial) || serial < 1)
    throw new Error("invalid serial");
  return `TM${String(serial).padStart(6, "0")}`;
}
export function titleWithCode(title: string, code: string, limit: number) {
  const suffix = ` ${code}`,
    room = limit - Array.from(suffix).length;
  if (room < 1)
    throw new Fault("TITLE_TOO_SHORT", "标题上限无法容纳完整商品编号", 400);
  return (
    Array.from(title.replace(new RegExp(`\\s*${code}$`), "").trim())
      .slice(0, room)
      .join("")
      .trimEnd() + suffix
  );
}
export function parseMoney(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("金额必须非负且最多2位小数");
  const [a, b = ""] = value.split(".");
  const cents = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 2000000000)
    throw new Error("金额超限");
  return cents;
}
export function contribution(s: {
  amount: number | null;
  cost: number | null;
  fees: number | null;
  refunded: number;
  returned: boolean;
  paid: boolean;
  cooperation: string;
}) {
  if (s.cooperation === "EXCLUDED") return { state: "EXCLUDED", value: null };
  if (
    s.cooperation !== "INCLUDED" ||
    !s.paid ||
    s.amount === null ||
    s.cost === null ||
    s.fees === null
  )
    return { state: "PENDING", value: null };
  return {
    state: "INCLUDED",
    value: s.amount - s.refunded - (s.returned ? 0 : s.cost) - s.fees,
  };
}
export function assetUsable(
  a: {
    rights: string;
    verified: boolean;
    validUntil: Date | null;
    role: string;
    origin?: string;
    archived?: boolean;
  },
  now = new Date(),
) {
  return (
    !a.archived &&
    !["AI", "REFERENCE"].includes(a.origin || "OWN") &&
    a.rights === "PUBLIC" &&
    a.verified &&
    (!a.validUntil || a.validUntil > now) &&
    ["PRODUCT", "DETAIL", "DEFECT"].includes(a.role)
  );
}
export type Requirement = { code: string; title: string; blocking: boolean };
export function requirements(input: {
  title: string;
  brand: string;
  category: string;
  facts: Facts;
  assetCount: number;
  exemptions?: string[];
  english: boolean;
  trade: boolean;
  offerValid: boolean;
  ownership: string;
  price: number | null;
  currency: string;
  requiredCurrency?: string | null;
  status: string;
}) {
  const r: Requirement[] = [];
  const need = (test: boolean, code: string, title: string) => {
    if (!test) r.push({ code, title, blocking: true });
  };
  need(!!input.brand, "brand", "补充品牌");
  need(!!input.title, "title", "补充名称");
  need(
    input.assetCount > 0,
    "images",
    "取得并核对可公开使用的实物图片（可复用供应商资料）",
  );
  need(!!input.facts.condition, "condition", "描述实际品相和瑕疵");
  need(
    (input.exemptions || []).includes("measurements") ||
      (!!input.facts.measurements && !!input.facts.measurementSource),
    "measurements",
    "补充尺寸及依据（已有尺寸可复用，无须重新测量）",
  );
  if (input.trade) {
    need(
      input.facts.authentication.status === "PASSED" &&
        !!input.facts.authentication.evidence,
      "authentication",
      "逐件真实性复核及依据",
    );
    need(
      input.price !== null && input.price > 0,
      "price",
      "补充大于零的当前对外报价",
    );
    need(
      input.price === null ||
        !input.requiredCurrency ||
        input.currency === input.requiredCurrency,
      "price_currency",
      input.requiredCurrency
        ? `该渠道须使用 ${input.requiredCurrency} 报价`
        : "核对渠道报价币种",
    );
    need(
      input.ownership === "OWN" || input.offerValid,
      "supply",
      "重新确认供应商当前仍有货",
    );
    need(input.status === "AVAILABLE", "availability", "商品当前不允许新交易");
  }
  need(
    !!(input.english ? input.facts.descriptionEn : input.facts.descriptionZh),
    input.english ? "english" : "copy",
    input.english ? "补充英文内容" : "补充中文内容",
  );
  return r;
}
