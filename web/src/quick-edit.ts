import { createElement } from "react";
import { mountView } from "./arco/runtime";
import { QuickFields } from "./arco/quick-fields";
import {
  ApiError,
  button,
  cents,
  dialog,
  form,
  onDialogClosed,
  request,
  text,
} from "./core";
import {
  bindDictionaryFields,
  readDictionarySelections,
} from "./dictionary-picker";
import { type Item } from "./types";

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
    <div class="quick-edit-core"></div>`;
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
