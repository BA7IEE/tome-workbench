import type { Source } from "./types";
const categoryMap: Record<string, string> = {
  服装: "CLOTHING",
  包袋: "BAG",
  包包: "BAG",
  鞋履: "SHOES",
  鞋子: "SHOES",
  配饰: "ACCESSORY",
  其他: "OTHER",
};
export const sourceLabels: Record<string, string> = {
  brand: "品牌",
  category: "品类",
  supplierCode: "原货号",
  material: "材质",
  color: "颜色",
  sizeLabel: "标注尺码",
  measurements: "尺寸",
  measurementSource: "尺寸依据",
  condition: "品相",
  notes: "备注",
  descriptionZh: "中文介绍",
  descriptionEn: "英文介绍",
  quotedCost: "供货报价",
  currency: "币种",
  sourceUrl: "原始链接",
  ownership: "实物持有",
};
export function sourceValues(source: Source) {
  const p =
    source.payload &&
    typeof source.payload === "object" &&
    !Array.isArray(source.payload)
      ? (source.payload as Record<string, unknown>)
      : {};
  const value = (key: string) => {
    const v = p[key] ?? p[sourceLabels[key]];
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  };
  const rawCat = value("category"),
    category =
      categoryMap[rawCat] ||
      (["CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"].includes(rawCat)
        ? rawCat
        : "OTHER");
  const facts = Object.fromEntries(
    [
      "material",
      "color",
      "sizeLabel",
      "measurements",
      "measurementSource",
      "condition",
      "descriptionZh",
      "descriptionEn",
    ].map((k) => [k, value(k)]),
  );
  return {
    sourceId: source.id,
    title: source.title,
    brand: value("brand"),
    category,
    ownership: ["OWN","SUPPLIER"].includes(value("ownership"))
      ? value("ownership")
      : source.supplier ? "SUPPLIER" : "OWN",
    location: value("location") || source.supplier?.name || "",
    facts,
    currency: ["CNY", "USD", "EUR", "HKD", "GBP", "SGD"].includes(
      value("currency"),
    )
      ? value("currency")
      : "CNY",
  };
}
export function parseTable(raw: string) {
  const normalized = raw.replace(/^\uFEFF/, "");
  const delimiter = normalized.split(/\r?\n/)[0]?.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let n = 0; n < normalized.length; n++) {
    const c = normalized[n];
    if (c === '"') {
      if (quoted && normalized[n + 1] === '"') {
        cell += '"';
        n++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && normalized[n + 1] === "\n") n++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("表格内容里有未闭合的双引号，请检查或重新复制");
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("需要标题行和至少一行商品数据");
  if (rows.length > 301) throw new Error("每批最多300件，请拆分导入");
  const headers = rows[0].map((c) => c.trim());
  if (
    headers.some(
      (h) => !h || ["__proto__", "constructor", "prototype"].includes(h),
    ) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("列名不能为空或重复");
  return rows.slice(1).map((r, index) => {
    if (r.length !== headers.length)
      throw new Error(`第${index + 2}行列数与标题行不一致`);
    return Object.fromEntries(headers.map((h, n) => [h, r[n]]));
  });
}
