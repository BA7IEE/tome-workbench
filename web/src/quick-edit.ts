import { createElement } from "react";
import { mountView } from "./arco/runtime";
import { QuickFields } from "./arco/quick-fields";
import {
  ApiError,
  button,
  cents,
  dialog,
  formWithExit,
  onDialogClosed,
  request,
  text,
  me,
} from "./core";
import { saveQuickDraft } from "./quick-draft-transfer";
import { productEditHref } from "./product-navigation";
import {
  bindDictionaryFields,
  readDictionarySelections,
} from "./dictionary-picker";
import { type Item } from "./types";

export function quickEdit(item: Item, after?: () => Promise<void> | void) {
  let formEl: HTMLFormElement | null = null;
  const body = `<div class="quick-edit-note"><p>这里只修改名称、归类、报价与成色；图片、尺寸和材质请进入完整编辑。</p>${button(
    "进入完整编辑",
    () => {
      formEl?.querySelector<HTMLButtonElement>("header .close")?.click();
      if (!dialog.open) location.hash = productEditHref(item.id);
    },
    "subtle",
  )}${button("保留修改并进入完整编辑", () => {
    if (!formEl || !me) return;
    const origin = location.hash;
    if (windowExit.transferDraft(() => saveQuickDraft(me!.id, item, formEl!)))
      location.hash = productEditHref(item.id, origin);
  })}</div>
    <div class="quick-edit-core"></div>`;
  const windowExit = formWithExit(
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
            "这件商品刚被其他人修改。输入仍在此窗口；请点“保留修改并进入完整编辑”核对差异。",
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
  mountView(
    formEl.querySelector<HTMLElement>(".quick-edit-core")!,
    scope.signal,
  )(createElement(QuickFields, { item }));
  bindDictionaryFields(formEl, scope.signal);
  dialog.classList.add("quick-edit-dialog", "arco-workspace");
  onDialogClosed(() =>
    dialog.classList.remove("quick-edit-dialog", "arco-workspace"),
  );
}
