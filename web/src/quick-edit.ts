import { sourceFieldNote } from "./item-source-facts";
import {
  ApiError,
  button,
  cents,
  currencies,
  dialog,
  field,
  form,
  onDialogClosed,
  request,
  select,
  text,
} from "./core";
import {
  bindDictionaryFields,
  dictionaryField,
  readDictionarySelections,
} from "./dictionary-picker";
import { categories, type Item } from "./types";

export function quickEdit(item: Item, after?: () => Promise<void> | void) {
  let formEl: HTMLFormElement | null = null;
  const body = `<div class="quick-edit-note"><p>修改常用信息；图片、尺寸和详细介绍在完整商品页维护。</p>${button(
    "完整商品页",
    () => {
      formEl?.querySelector<HTMLButtonElement>("header .close")?.click();
      if (!dialog.open) location.hash = `/items/${item.id}/edit`;
    },
    "subtle",
  )}</div>
    ${field("title", "商品名称", item.title, "text", true)}
    <div class="quick-edit-brand">${dictionaryField("BRAND", item.dictionary?.brand || undefined, item.brand, item.brand)}${sourceFieldNote(item, "brand")}</div>
    ${select("category", "品类", categories, item.category)}
    <div class="quick-edit-price">${field("price", "对外报价", item.currentPrice == null ? "" : item.currentPrice / 100, "text", false, 'inputmode="decimal" placeholder="可留空"')}${select("currency", "币种", currencies, item.currency)}</div>
    ${dictionaryField("CONDITION", item.dictionary?.condition || undefined, item.facts.conditionGrade || "", item.facts.conditionGrade || "")}${sourceFieldNote(item, "condition")}`;
  form(
    `快速修改 · ${item.code}`,
    body,
    async (d, key) => {
      if (!formEl) throw new Error("快速修改窗口尚未准备完成");
      const picked = readDictionarySelections(formEl);
      try {
        return await request(
          `/items/${item.id}`,
          "PATCH",
          {
            version: item.version,
            title: text(d, "title"),
            brand: picked.labels.brand || "",
            dictionary: picked.dictionary,
            category: text(d, "category"),
            currentPrice: cents(d.get("price")),
            currency: text(d, "currency"),
            facts: { conditionGrade: picked.labels.condition || "" },
          },
          key,
        );
      } catch (error) {
        if (error instanceof ApiError && error.code === "VERSION_CONFLICT")
          throw new Error(
            "这件商品刚被其他人修改。当前输入已保留，请关闭后重新打开，或进入完整商品页核对差异。",
          );
        throw error;
      }
    },
    "保存修改",
    async () => {
      await after?.();
    },
  );
  formEl = dialog.querySelector<HTMLFormElement>("form")!;
  const scope = new AbortController();
  onDialogClosed(() => scope.abort());
  bindDictionaryFields(formEl, scope.signal);
  dialog.classList.add("quick-edit-dialog");
  onDialogClosed(() => dialog.classList.remove("quick-edit-dialog"));
}
