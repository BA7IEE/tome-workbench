import {
  request,
  form,
  field,
  area,
  select,
  check,
  text,
  can,
  note,
} from "./core";
export type DictionaryKind = "BRAND" | "CONDITION" | "COLOR" | "MATERIAL";
export interface DictionaryEntry {
  id: string;
  kind: DictionaryKind;
  code: string;
  label: string;
  labelEn: string;
  aliases: string[];
  description: string;
  categories: string[];
  sortOrder: number;
  active: boolean;
  version: number;
  _count?: { selections: number };
}
export const dictionaryNames: Record<DictionaryKind, string> = {
  BRAND: "品牌",
  CONDITION: "成色",
  COLOR: "颜色",
  MATERIAL: "主要材质",
};
export const dictionaryKeys = {
  BRAND: "brand",
  CONDITION: "condition",
  COLOR: "color",
  MATERIAL: "material",
} as const;
export type DictionarySelection = Partial<
  Record<"brand" | "condition" | "color" | "material", string | null>
>;
export const optionText = (e: Pick<DictionaryEntry, "label" | "labelEn">) =>
  e.labelEn && e.labelEn !== e.label ? `${e.label} · ${e.labelEn}` : e.label;
export function editDictionary(
  kind: DictionaryKind,
  current?: DictionaryEntry,
  after?: (entry: DictionaryEntry) => Promise<void>,
  initialLabel = "",
) {
  if (!can("dictionary")) throw new Error("需要字典管理权限");
  let saved: DictionaryEntry;
  const standard = kind === "CONDITION";
  const body =
    note(
      standard
        ? "成色采用Vestiaire Collective五级名称及定义；可管理启停和排序，不改写等级。"
        : "同一品牌的中英文名、缩写放在别名中，不重复创建。",
    ) +
    field(
      "label",
      "标准名称",
      current?.label || initialLabel,
      "text",
      true,
      standard ? "readonly" : "",
    ) +
    field(
      "labelEn",
      "英文名称",
      current?.labelEn || "",
      "text",
      false,
      standard ? "readonly" : "",
    ) +
    area("aliases", "别名（每行一个）", current?.aliases.join("\n") || "", 3) +
    (standard
      ? field(
          "description",
          "等级说明",
          current?.description || "",
          "text",
          false,
          "readonly",
        )
      : area("description", "说明", current?.description || "", 3)) +
    (standard
      ? note("适用全部品类，成色不按品类任意改写。")
      : select(
          "category",
          "适用品类",
          {
            "": "全部品类",
            CLOTHING: "服装",
            BAG: "包袋",
            SHOES: "鞋履",
            ACCESSORY: "配饰",
            OTHER: "其他",
          },
          current?.categories[0] || "",
        )) +
    field(
      "sortOrder",
      "显示排序",
      current?.sortOrder ?? 100,
      "number",
      true,
      'min="0" max="99999"',
    ) +
    check("active", "启用此选项", current?.active ?? true);
  form(
    current ? "编辑" + dictionaryNames[kind] : "新增" + dictionaryNames[kind],
    body,
    async (d, key) => {
      const values = {
        label: text(d, "label"),
        labelEn: text(d, "labelEn"),
        aliases: text(d, "aliases")
          .split(/[\n，,]/)
          .map((v) => v.trim())
          .filter(Boolean),
        description: text(d, "description"),
        categories: text(d, "category") ? [text(d, "category")] : [],
        sortOrder: Number(text(d, "sortOrder")),
        active: d.has("active"),
      };
      saved = await request<DictionaryEntry>(
        current ? "/dictionaries/" + current.id : "/dictionaries",
        "POST",
        current ? { ...values, version: current.version } : { ...values, kind },
        key,
      );
      return saved;
    },
    "保存选项",
    after ? async () => after(saved) : undefined,
  );
}
