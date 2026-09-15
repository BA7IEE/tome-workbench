import { can, field, area, select, currencies, money } from "./core";
import { dictionaryField } from "./dictionary-picker";
import { sourceFieldNote } from "./item-source-facts";
import { categories, type Item } from "./types";
import { researchRow, attributeRow, attributeNames } from "./editor-fields";
const card = (title: string, body: string, cls = "") =>
  `<section class="studio-card ${cls}"><h2>${title}</h2>${body}</section>`;
const optional = (title: string, body: string, id: string) =>
  `<details class="studio-card studio-optional" data-section="${id}"><summary>${title}</summary><div class="studio-optional-body">${body}</div></details>`;
/** Structure follows the operator's task. Parsing and version comparison remain shared. */
export function studioFields(i: Item) {
  const f = i.facts;
  const dimensions =
    field("sizeLabel", "标签尺码", f.sizeLabel) +
    area("measurements", "实测尺寸", f.measurements, 2) +
    field("measurementSource", "尺寸来源", f.measurementSource) +
    dictionaryField(
      "COLOR",
      i.dictionary?.color || undefined,
      f.color,
      f.color,
    ) +
    sourceFieldNote(i, "color") +
    dictionaryField(
      "MATERIAL",
      i.dictionary?.material || undefined,
      f.mainMaterial || "",
      f.mainMaterial || "",
    ) +
    field(
      "material",
      "材质成分 / 细节",
      f.material,
      "text",
      false,
      'placeholder="例如：80%羊毛、20%锦纶"',
    );
  const evidence = can("review")
    ? select(
        "authStatus",
        "真实性复核",
        { UNKNOWN: "未确认", PASSED: "通过", FAILED: "存疑 / 未通过" },
        f.authentication.status,
      ) +
      area("authEvidence", "鉴定 / 复核依据", f.authentication.evidence, 2) +
      `<div id="research-rows">${f.research.map((r, n) => researchRow(r, n, true)).join("")}</div><button class="btn" type="button" id="add-research">＋ 添加一条资料依据</button>`
    : "<p>鉴定资料由复核人员确认；日常录货可先保存。</p>";
  const attributes =
    `<div id="attribute-rows">${Object.entries(f.attributes)
      .map(([k, v], n) =>
        attributeRow(k, f.attributeLabels?.[k] || attributeNames[k] || k, v, n),
      )
      .join("")}</div>` +
    select("newAttribute", "常用扩展字段", {
      "": "自定义字段",
      ...attributeNames,
    }) +
    '<button class="btn" id="add-attribute" type="button">＋ 添加字段</button>';
  return `<div class="studio-main-column">${card("商品信息", field("title", "商品名称", i.title, "text", true), "studio-title-card")}<div data-media-slot></div>${card("商品描述", area("descriptionZh", "中文介绍", f.descriptionZh, 5), "studio-description")}${optional("尺寸与材质", `<div class="form-grid">${dimensions}</div>`, "dimensions")}${optional("英文介绍", area("descriptionEn", "英文介绍", f.descriptionEn, 5), "english")}${optional("更多资料 · 年份、设计师、系列", attributes, "attributes")}</div>
 <aside class="studio-inspector">${card("商品归类", dictionaryField("BRAND", i.dictionary?.brand || undefined, i.brand, i.brand) + sourceFieldNote(i, "brand") + select("category", "品类", categories, i.category), "studio-classification-card")}${card("价格", `<div class="studio-price">${field("price", "对外报价", i.currentPrice == null ? "" : i.currentPrice / 100, "text", false, 'inputmode="decimal" placeholder="暂不定价可留空"')}${select("currency", "币种", currencies, i.currency)}</div>${i.currentCostCny !== undefined ? `<div class="studio-cost-fact"><span>当前人民币成本</span><strong>${money(i.currentCostCny, "CNY")}</strong><small>采购来源与成本依据可在历史中追溯</small></div>` : ""}`, "studio-price-card")}${card("成色与品相", dictionaryField("CONDITION", i.dictionary?.condition || undefined, f.conditionGrade || "", f.conditionGrade || "") + sourceFieldNote(i, "condition") + area("condition", "瑕疵与使用痕迹", f.condition, 3), "studio-condition-card")}<div data-source-slot></div>${optional("鉴定与资料", evidence, "authentication")}<div data-review-slot></div><p class="studio-hint">只填已知信息即可保存。可先使用已整理的资料，其他内容以后逐步补充。</p></aside>`;
}
export function placeStudioSections(form: HTMLFormElement) {
  const fields = form.querySelector(".entry-fields")!;
  const media = fields.querySelector("[data-media-slot]")!;
  const photos = form.querySelector(".entry-photos"),
    existing = form.querySelector(".entry-existing-media");
  if (photos) {
    media.append(photos);
    if (existing) photos.querySelector(".entry-drop")!.before(existing);
  }
  const source = form.querySelector(".entry-source");
  if (source) {
    const holder = fields.querySelector("[data-source-slot]")!,
      details = document.createElement("details");
    details.className = "studio-card studio-optional";
    details.dataset.section = "supply";
    details.innerHTML =
      '<summary>货源与实物</summary><div class="studio-optional-body"></div>';
    const body = details.lastElementChild!;
    while (source.firstChild) body.append(source.firstChild);
    body.querySelector("h2")?.remove();
    holder.append(details);
    source.remove();
  }
  const review = form.querySelector(".entry-review");
  if (review) {
    review.className = "studio-card studio-inline-review";
    (
      fields.querySelector(
        "[data-section=authentication] .studio-optional-body",
      ) || fields.querySelector("[data-review-slot]")!
    ).append(review);
  }
}
export function focusStudioField(form: HTMLFormElement, name: string) {
  const selectors: Record<string, string> = {
    images: ".entry-photos",
    brand: '[data-dictionary="BRAND"] .dictionary-input',
    title: "[name=title]",
    price: "[name=price]",
    condition: "[name=condition]",
    measurements: "[name=measurements]",
    authentication: "[name=authStatus]",
    english: "[name=descriptionEn]",
    copy: "[name=descriptionZh]",
    supply: "[data-section=supply]",
    availability: "[data-stock-controls]",
  };
  const target = form.querySelector<HTMLElement>(
    selectors[name] || `[name="${CSS.escape(name)}"]`,
  );
  if (!target) return;
  for (let p: HTMLElement | null = target; p; p = p.parentElement)
    if (p instanceof HTMLDetailsElement) p.open = true;
  target.scrollIntoView({ block: "center", behavior: "instant" });
  (target.querySelector<HTMLElement>("input,textarea,select") || target).focus({
    preventScroll: true,
  });
  target.classList.add("studio-highlight");
  setTimeout(() => target.classList.remove("studio-highlight"), 1400);
}
