import { esc, field, area, select, check } from "./core";
import type { Facts } from "./types";
export const attributeNames: Record<string, string> = {
  designer: "设计师",
  year: "年份",
  season: "季节 / 系列",
  model: "款式 / 型号",
  styleNumber: "款号",
  collection: "系列名称",
  accessories: "随附物品",
  care: "养护说明",
};
export function researchRow(
  row: Facts["research"][number],
  index: number,
  review: boolean,
) {
  return `<fieldset class="research-row" data-research="${index}"><legend>资料依据 ${index + 1}</legend>${field("claim_" + index, "结论或线索", row.claim)}${area("evidence_" + index, "来源链接或核对说明", row.evidence, 2)}${review ? check("confirmed_" + index, "已人工确认此依据", row.confirmed) : ""}<button type="button" class="btn subtle" data-remove-row>移除此条</button></fieldset>`;
}
export function attributeRow(
  key: string,
  label: string,
  value: string | number | boolean,
  index: number,
) {
  const type = typeof value;
  return `<fieldset class="attribute-row" data-attribute="${index}" data-key="${esc(key)}">${field("attr_label_" + index, "字段名称", label)}${select("attr_type_" + index, "值类型", { string: "文字", number: "数字", boolean: "是 / 否" }, type)}${field("attr_value_" + index, "字段值", value === true ? "是" : value === false ? "否" : value)}<button type="button" class="btn subtle" data-remove-row>移除此项</button></fieldset>`;
}
export function parseAttributes(form: HTMLFormElement, data: FormData) {
  const values: Facts["attributes"] = {},
    labels: Record<string, string> = {};
  for (const row of form.querySelectorAll<HTMLElement>("[data-attribute]")) {
    const n = row.dataset.attribute!,
      key = row.dataset.key!,
      label = String(data.get("attr_label_" + n) || "").trim(),
      raw = String(data.get("attr_value_" + n) || "").trim(),
      type = String(data.get("attr_type_" + n));
    if (!label && !raw) continue;
    if (!label) throw new Error("请填写扩展字段名称");
    if (type === "number") {
      if (!raw || !Number.isFinite(Number(raw)))
        throw new Error(label + "应填写有效数字");
      values[key] = Number(raw);
    } else if (type === "boolean") {
      if (!["是", "否", "true", "false"].includes(raw))
        throw new Error(label + "请填写是或否");
      values[key] = ["是", "true"].includes(raw);
    } else values[key] = raw;
    labels[key] = label;
  }
  if (Object.keys(values).length > 60)
    throw new Error("单件商品扩展字段最多60项");
  return { values, labels };
}
