import {
  request,
  form,
  dialog,
  note,
  check,
  esc,
  onDialogClosed,
} from "./core";
import {
  dictionaryField,
  bindDictionaryFields,
  readDictionarySelections,
} from "./dictionary-picker";
import {
  dictionaryKeys,
  dictionaryNames,
  type DictionaryKind,
  type DictionarySelection,
} from "./dictionary-editor";
import { batchActions } from "./batch-actions";
import type { Item } from "./types";
export function bulkDictionaries(
  items: Pick<Item, "id" | "code" | "title" | "version">[],
) {
  if (!items.length || items.length > 100) throw new Error("请选择1—100件商品");
  const kinds: DictionaryKind[] = ["BRAND", "CONDITION", "COLOR", "MATERIAL"];
  form(
    "批量修改商品属性",
    note(
      `将逐件处理所选${items.length}件。仅修改勾选字段，其他资料、图片、价格和库存不会改变。`,
    ) +
      kinds
        .map(
          (kind) =>
            `<section class="full">${check("change_" + dictionaryKeys[kind], "修改" + dictionaryNames[kind])}${dictionaryField(kind, undefined)}</section>`,
        )
        .join("") +
      check("allowClear", "确认清空已勾选但没有选值的字段（默认不允许清空）") +
      check("confirmed", "我已逐件核对，所选属性适用于本次全部商品") +
      `<details class="full"><summary>查看所选商品</summary>${items.map((i) => `<p>${esc(i.code)} · ${esc(i.title)}</p>`).join("")}</details>`,
    async (d) => {
      if (!d.has("confirmed")) throw new Error("请先核对所选商品并确认");
      const values = readDictionarySelections(
          dialog.querySelector("form")!,
        ).dictionary,
        dictionary: DictionarySelection = {};
      for (const kind of kinds) {
        const key = dictionaryKeys[kind];
        if (d.has("change_" + key)) {
          if (!values[key] && !d.has("allowClear"))
            throw new Error(
              `请为${dictionaryNames[kind]}选择值；确需清空时单独确认`,
            );
          dictionary[key] = values[key] || null;
        }
      }
      if (!Object.keys(dictionary).length)
        throw new Error("请勾选至少一个需要修改的字段");
      setTimeout(
        () =>
          batchActions(
            "批量修改属性结果",
            items.map((i) => ({
              label: i.code + " " + i.title,
              run: (key) =>
                request(
                  `/items/${i.id}`,
                  "PATCH",
                  { version: i.version, dictionary },
                  key,
                ),
            })),
          ),
        0,
      );
      return { nextStep: true };
    },
    "核对后进入批量执行",
  );
  const scope = new AbortController();
  bindDictionaryFields(dialog.querySelector("form")!, scope.signal);
  onDialogClosed(() => scope.abort());
}
