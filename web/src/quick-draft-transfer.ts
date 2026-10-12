import type { Item } from "./types";
type Base = Pick<
  Item,
  | "version"
  | "title"
  | "brand"
  | "category"
  | "currentPrice"
  | "currency"
  | "dictionary"
> & { conditionGrade: string };
export type QuickDraft = {
  owner: string;
  itemId: string;
  base: Base;
  fields: Record<string, string>;
};
const drafts = new Map<string, QuickDraft>();
let account = "";
function scope(owner: string) {
  if (account !== owner) {
    drafts.clear();
    account = owner;
  }
}
export function saveQuickDraft(
  owner: string,
  item: Item,
  form: HTMLFormElement,
) {
  scope(owner);
  const data = new FormData(form);
  const fields = Object.fromEntries(
    [
      "title",
      "category",
      "price",
      "currency",
      "dict_brand",
      "dict_condition",
    ].map((key) => [key, String(data.get(key) || "")]),
  );
  fields.brandText =
    form.querySelector<HTMLInputElement>(
      '[data-dictionary="BRAND"] .dictionary-input',
    )?.value || "";
  fields.conditionText =
    form.querySelector<HTMLElement>('[data-dictionary="CONDITION"]')?.dataset
      .selectedLabel || "";
  const base: Base = {
    version: item.version,
    title: item.title,
    brand: item.brand,
    category: item.category,
    currentPrice: item.currentPrice,
    currency: item.currency,
    dictionary: structuredClone(item.dictionary),
    conditionGrade: item.facts.conditionGrade,
  };
  drafts.set(item.id, { owner, itemId: item.id, base, fields });
  if (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
}
export function peekQuickDraft(owner: string, itemId: string) {
  scope(owner);
  return drafts.get(itemId);
}
export function clearQuickDraft(owner: string, itemId: string) {
  scope(owner);
  drafts.delete(itemId);
}
/** Only operator-changed fields use the old comparison basis; untouched fields
 * come from the latest read, and the old version still protects the next write. */
export function applyQuickDraft(latest: Item, draft: QuickDraft) {
  const base = {
    ...latest,
    facts: { ...latest.facts },
    dictionary: { ...latest.dictionary },
    version: draft.base.version,
  };
  const fields: Record<string, string> = {};
  for (const key of ["title", "category", "currency"] as const) {
    if (draft.fields[key] !== draft.base[key]) {
      fields[key] = draft.fields[key];
      base[key] = draft.base[key];
    }
  }
  const originalPrice =
    draft.base.currentPrice == null
      ? ""
      : String(draft.base.currentPrice / 100);
  if (draft.fields.price !== originalPrice) {
    fields.price = draft.fields.price;
    base.currentPrice = draft.base.currentPrice;
  }
  for (const key of ["brand", "condition"] as const) {
    const oldId = draft.base.dictionary?.[key] || "";
    const text = key === "brand" ? draft.base.brand : draft.base.conditionGrade;
    if (
      draft.fields[`dict_${key}`] !== oldId ||
      draft.fields[`${key}Text`] !== text
    ) {
      fields[`dict_${key}`] = draft.fields[`dict_${key}`];
      fields[`${key}Text`] = draft.fields[`${key}Text`];
      base.dictionary[key] = oldId || null;
      if (key === "brand") base.brand = draft.base.brand;
      else base.facts.conditionGrade = draft.base.conditionGrade;
    }
  }
  return { base, fields };
}
