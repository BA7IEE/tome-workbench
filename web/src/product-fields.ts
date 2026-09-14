import {
  dictionaryField,
  bindDictionaryFields,
  readDictionarySelections,
} from "./dictionary-picker";
import {
  can,
  field,
  area,
  select,
  currencies,
  text,
  cents,
  note,
} from "./core";
import { categories } from "./types";
import type { Item, Facts } from "./types";
import {
  researchRow,
  attributeRow,
  attributeNames,
  parseAttributes,
} from "./editor-fields";
import { sourceFieldNote } from "./item-source-facts";
export type ProductPatch = {
  version: number;
  dictionary?: import("./dictionary-editor").DictionarySelection;
  title?: string;
  brand?: string;
  category?: string;
  currentPrice?: number | null;
  currency?: string;
  facts?: Partial<Facts>;
};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const group = (title: string, body: string) =>
  `<section class="editor-section full"><h3>${title}</h3><div class="form-grid">${body}</div></section>`;
export function changedProduct(base: Item, current: Item): ProductPatch {
  const p: ProductPatch = { version: base.version };
  for (const k of [
    "title",
    "brand",
    "category",
    "currentPrice",
    "currency",
  ] as const)
    if (!equal(base[k], current[k])) Object.assign(p, { [k]: current[k] });
  const dictionary: import("./dictionary-editor").DictionarySelection = {};
  for (const key of ["brand", "condition", "color", "material"] as const)
    if (
      (current.dictionary?.[key] || null) !== (base.dictionary?.[key] || null)
    )
      dictionary[key] = current.dictionary?.[key] || null;
  if (Object.keys(dictionary).length) p.dictionary = dictionary;
  const facts: Partial<Facts> = {};
  for (const k of Object.keys(current.facts) as (keyof Facts)[])
    if (
      !equal(
        k === "attributeLabels" ? base.facts[k] || {} : base.facts[k],
        current.facts[k],
      )
    )
      Object.assign(facts, { [k]: current.facts[k] });
  if (Object.keys(facts).length) p.facts = facts;
  return p;
}

export function productFields(i: Item) {
  const f = i.facts;
  return (
    group(
      "1 · 基本信息",
      field("title", "商品名称", i.title, "text", true) +
        dictionaryField(
          "BRAND",
          i.dictionary?.brand || undefined,
          i.brand,
          i.brand,
        ) +
        sourceFieldNote(i, "brand") +
        select("category", "品类", categories, i.category) +
        field(
          "price",
          "对外报价",
          i.currentPrice == null ? "" : i.currentPrice / 100,
          "text",
          false,
          'inputmode="decimal"',
        ) +
        select("currency", "币种", currencies, i.currency) +
        field("sizeLabel", "标签尺码", f.sizeLabel),
    ) +
    group(
      "2 · 实物与品相",
      field(
        "material",
        "材质成分 / 细节",
        f.material,
        "text",
        false,
        'placeholder="补充纤维比例、部位；主要材质可在下方选择"',
      ) +
        dictionaryField(
          "COLOR",
          i.dictionary?.color || undefined,
          f.color,
          f.color,
        ) +
        sourceFieldNote(i, "color") +
        dictionaryField(
          "CONDITION",
          i.dictionary?.condition || undefined,
          f.conditionGrade || "",
          f.conditionGrade || "",
        ) +
        sourceFieldNote(i, "condition") +
        dictionaryField(
          "MATERIAL",
          i.dictionary?.material || undefined,
          f.mainMaterial || "",
          f.mainMaterial || "",
        ) +
        area("measurements", "实测尺寸", f.measurements, 2) +
        field("measurementSource", "尺寸来源", f.measurementSource) +
        area("condition", "瑕疵与使用痕迹", f.condition, 3),
    ) +
    group(
      "3 · 商品介绍",
      area("descriptionZh", "中文介绍", f.descriptionZh, 5) +
        area("descriptionEn", "英文介绍", f.descriptionEn, 5),
    ) +
    (can("review")
      ? group(
          "4 · 复核与资料依据",
          select(
            "authStatus",
            "真实性复核",
            { UNKNOWN: "未确认", PASSED: "通过", FAILED: "存疑 / 未通过" },
            f.authentication.status,
          ) +
            area(
              "authEvidence",
              "鉴定 / 复核依据",
              f.authentication.evidence,
              2,
            ) +
            `<div class="full" id="research-rows">${f.research.map((r, n) => researchRow(r, n, true)).join("")}</div><button class="btn" type="button" id="add-research">＋ 添加一条资料依据</button>`,
        )
      : "") +
    group(
      "扩展资料",
      note(
        "按需要增加年份、设计师、型号等字段；没有查清的信息留空，不会自动当作已确认事实。",
      ) +
        `<div class="full" id="attribute-rows">${Object.entries(f.attributes)
          .map(([k, v], n) =>
            attributeRow(
              k,
              f.attributeLabels?.[k] || attributeNames[k] || k,
              v,
              n,
            ),
          )
          .join("")}</div>` +
        select("newAttribute", "常用扩展字段", {
          "": "自定义字段",
          ...attributeNames,
        }) +
        `<button class="btn" id="add-attribute" type="button">＋ 添加字段</button>`,
    )
  );
}

export function readProduct(el: HTMLFormElement, d: FormData, i: Item): Item {
  const f = i.facts;
  const attrs = parseAttributes(el, d);
  const picked = readDictionarySelections(el);
  const facts: Facts = {
    ...f,
    material: text(d, "material"),
    color: picked.labels.color,
    conditionGrade: picked.labels.condition,
    mainMaterial: picked.labels.material,
    sizeLabel: text(d, "sizeLabel"),
    measurements: text(d, "measurements"),
    measurementSource: text(d, "measurementSource"),
    condition: text(d, "condition"),
    descriptionZh: text(d, "descriptionZh"),
    descriptionEn: text(d, "descriptionEn"),
    attributes: attrs.values,
    attributeLabels: attrs.labels,
  };
  if (can("review")) {
    facts.authentication = {
      status: text(d, "authStatus"),
      evidence: text(d, "authEvidence"),
    };
    facts.research = [...el.querySelectorAll<HTMLElement>("[data-research]")]
      .map((row) => {
        const n = row.dataset.research!;
        return {
          claim: text(d, "claim_" + n),
          evidence: text(d, "evidence_" + n),
          confirmed: d.has("confirmed_" + n),
        };
      })
      .filter((row) => row.claim || row.evidence || row.confirmed);
    if (facts.research.length > 40) throw new Error("每件商品最多40条资料依据");
    if (facts.research.some((r) => !r.claim || (r.confirmed && !r.evidence)))
      throw new Error("资料需填写结论；已确认的结论还必须填写依据");
  }
  const next: Item = {
    ...i,
    title: text(d, "title"),
    brand: picked.labels.brand,
    dictionary: picked.dictionary,
    category: text(d, "category"),
    currentPrice: cents(d.get("price")),
    currency: text(d, "currency"),
    facts,
  };

  return next;
}

export function bindProductRows(
  el: HTMLFormElement,
  signal: AbortSignal = new AbortController().signal,
) {
  bindDictionaryFields(el, signal);
  let researchCount =
    Math.max(
      -1,
      ...Array.from(el.querySelectorAll<HTMLElement>("[data-research]"), (r) =>
        Number(r.dataset.research),
      ),
    ) + 1;
  let attributeCount =
    Math.max(
      -1,
      ...Array.from(el.querySelectorAll<HTMLElement>("[data-attribute]"), (r) =>
        Number(r.dataset.attribute),
      ),
    ) + 1;
  el.querySelector("#add-research")?.addEventListener("click", () => {
    if (el.querySelectorAll("[data-research]").length >= 40) return;
    el.querySelector("#research-rows")!.insertAdjacentHTML(
      "beforeend",
      researchRow(
        { claim: "", evidence: "", confirmed: false },
        researchCount++,
        true,
      ),
    );
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  el.querySelector("#add-attribute")!.addEventListener("click", () => {
    if (el.querySelectorAll("[data-attribute]").length >= 60) return;
    const choice = (
        el.querySelector('[name="newAttribute"]') as HTMLSelectElement
      ).value,
      key =
        choice ||
        "custom_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    if (
      [...el.querySelectorAll<HTMLElement>("[data-attribute]")].some(
        (r) => r.dataset.key === key,
      )
    )
      return;
    el.querySelector("#attribute-rows")!.insertAdjacentHTML(
      "beforeend",
      attributeRow(key, attributeNames[key] || "", "", attributeCount++),
    );
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  el.addEventListener("click", (e) => {
    const target = (e.target as Element).closest("[data-remove-row]");
    if (target) {
      target.closest("fieldset")!.remove();
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
