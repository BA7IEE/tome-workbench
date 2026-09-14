import { esc } from "./core";
import type { Item } from "./types";

// Source wording is a reference snapshot, never a dictionary selection or a
// fresh inspection of the physical item. Maintained local fields take priority.
export function sourceValue(i: Item, key: string) {
  const value = i.facts.attributes?.[key];
  return typeof value === "string" ? value.trim() : "";
}
export function catalogBrand(i: Item) {
  const source = sourceValue(i, "sourceBrand");
  return i.brand || (source ? `${source}（来源品牌）` : "品牌待补");
}
export function catalogCondition(i: Item) {
  const source = sourceValue(i, "sourceCondition");
  return (
    i.facts.conditionGrade || (source ? `来源成色：${source}` : "成色待补")
  );
}
export function sourceFieldNote(
  i: Item,
  kind: "brand" | "condition" | "color",
) {
  const key = {
    brand: "sourceBrand",
    condition: "sourceCondition",
    color: "sourceColor",
  }[kind];
  const value = sourceValue(i, key);
  const detail =
    kind === "condition" ? sourceValue(i, "sourceConditionDetails") : "";
  const detailZh =
    kind === "condition" ? sourceValue(i, "sourceConditionDetailsZh") : "";
  if (!value && !detail && !detailZh) return "";
  const label = { brand: "品牌", condition: "成色", color: "颜色" }[kind];
  const source = sourceValue(i, "sourcePlatform") || "来源";
  return `<div class="source-field-note full" data-source-field="${kind}"><strong>${esc(source)}记录${value ? ` · ${esc(label)}：${esc(value)}` : ""}</strong>${detailZh ? `<p>${esc(detailZh)}</p>` : ""}${detail ? `<p>${esc(detail)}</p>` : ""}${kind === "condition" ? "<small>来源记录供核对；上方成色等级由我们验货后确认。</small>" : ""}</div>`;
}
