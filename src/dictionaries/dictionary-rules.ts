import { z } from "zod";
import { safeText, uuid } from "../common/domain";
export const kinds = ["BRAND", "CONDITION", "COLOR", "MATERIAL"] as const;
export const dictionaryKind = z.enum(kinds);
export type DictionaryKind = z.infer<typeof dictionaryKind>;
export const dictionaryNames = {
  BRAND: "品牌",
  CONDITION: "成色等级",
  COLOR: "颜色",
  MATERIAL: "主要材质",
};
export const selectionSchema = z
  .object({
    brand: uuid.nullable().optional(),
    condition: uuid.nullable().optional(),
    color: uuid.nullable().optional(),
    material: uuid.nullable().optional(),
  })
  .strict();
export type SelectionInput = z.infer<typeof selectionSchema>;
export const kindKeys = {
  BRAND: "brand",
  CONDITION: "condition",
  COLOR: "color",
  MATERIAL: "material",
} as const;
export function normalizeTerm(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export const dictionaryInput = z
  .object({
    kind: dictionaryKind,
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,47}$/)
      .optional(),
    label: safeText(100).min(1),
    labelEn: safeText(100).default(""),
    aliases: z.array(safeText(100).min(1)).max(40).default([]),
    description: safeText(1500).default(""),
    categories: z
      .array(z.enum(["CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"]))
      .max(5)
      .default([]),
    sortOrder: z.number().int().min(0).max(99999).default(100),
    active: z.boolean().default(true),
  })
  .strict();
export const dictionaryUpdate = dictionaryInput
  .omit({ kind: true, code: true })
  .extend({ version: z.number().int().positive() })
  .strict();
export function termsOf(v: {
  label: string;
  labelEn: string;
  aliases: string[];
}) {
  return [
    ...new Set(
      [v.label, v.labelEn, ...v.aliases].map(normalizeTerm).filter(Boolean),
    ),
  ];
}
