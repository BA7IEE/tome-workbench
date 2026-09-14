import type { ItemDictionarySelection } from "@prisma/client";
import { type Tx, lock } from "../common/transaction";
import { type Facts } from "../common/domain";
import { Fault } from "../common/errors";
import {
  kinds,
  kindKeys,
  dictionaryNames,
  normalizeTerm,
  type SelectionInput,
  type DictionaryKind,
} from "./dictionary-rules";
type Values = { brand: string; facts: Facts; category: string };
type Selection = Omit<ItemDictionarySelection, "itemId" | "selectedAt">;
const factKeys = {
  CONDITION: "conditionGrade",
  COLOR: "color",
  MATERIAL: "mainMaterial",
} as const;
function value(v: Values, kind: DictionaryKind) {
  return kind === "BRAND" ? v.brand : v.facts[factKeys[kind]];
}
function set(v: Values, kind: DictionaryKind, label: string, en = "") {
  if (kind === "BRAND") v.brand = label;
  else {
    v.facts[factKeys[kind]] = label;
    if (kind === "CONDITION") v.facts.conditionGradeEn = en;
  }
}
export async function resolveItemDictionaries(
  tx: Tx,
  values: Values,
  input: SelectionInput | undefined,
  itemId?: string,
) {
  const result = { ...values, facts: { ...values.facts } },
    old = itemId
      ? await tx.itemDictionarySelection.findMany({ where: { itemId } })
      : [];
  const selections: Selection[] = [];
  await lock(tx, "dictionary:catalog");
  for (const kind of kinds) {
    const key = kindKeys[kind],
      previous = old.find((s) => s.kind === kind),
      explicit = input && Object.hasOwn(input, key);
    let id = explicit ? input![key] : undefined;
    if (!explicit) {
      const raw = value(result, kind);
      if (previous && raw === previous.label) id = previous.entryId;
      else if (raw) {
        const term = await tx.dictionaryTerm.findUnique({
          where: { kind_normalized: { kind, normalized: normalizeTerm(raw) } },
        });
        if (!term)
          throw new Fault(
            "DICTIONARY_REQUIRED",
            `${dictionaryNames[kind]}“${raw}”不在字典中，请选择已有选项或请管理员添加`,
            400,
          );
        id = term.entryId;
      }
    }
    if (!id) {
      set(result, kind, "");
      continue;
    }
    const entry = await tx.dictionaryEntry.findUnique({ where: { id } });
    if (!entry || entry.kind !== kind)
      throw new Fault(
        "DICTIONARY_WRONG_KIND",
        `${dictionaryNames[kind]}选项不存在或类型不正确`,
        400,
      );
    // Existing selections retain their historical wording. New selections must be active and category-appropriate.
    if (entry.categories.length && !entry.categories.includes(values.category))
      throw new Fault(
        "DICTIONARY_CATEGORY",
        `${entry.label}不适用于当前品类`,
        400,
      );
    if (previous?.entryId === id && value(result, kind) === previous.label) {
      const { itemId: _i, selectedAt: _t, ...saved } = previous;
      void _i;
      void _t;
      set(result, kind, saved.label, saved.labelEn);
      selections.push(saved);
      continue;
    }
    if (!entry.active)
      throw new Fault(
        "DICTIONARY_DISABLED",
        `${entry.label}已停用，请选择其他选项或留空`,
        400,
      );
    set(result, kind, entry.label, entry.labelEn);
    selections.push({
      kind,
      entryId: id,
      entryVersion: entry.version,
      code: entry.code,
      label: entry.label,
      labelEn: entry.labelEn,
      description: entry.description,
    });
  }
  const signature = (
    rows: Pick<
      ItemDictionarySelection,
      "kind" | "entryId" | "entryVersion" | "label" | "labelEn" | "description"
    >[],
  ) =>
    JSON.stringify(
      rows
        .map((r) => [
          r.kind,
          r.entryId,
          r.entryVersion,
          r.label,
          r.labelEn,
          r.description,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  return {
    ...result,
    selections,
    selectionChanged: signature(old) !== signature(selections),
  };
}
export async function saveItemDictionaries(
  tx: Tx,
  itemId: string,
  selections: Selection[],
) {
  await tx.itemDictionarySelection.deleteMany({
    where: { itemId, kind: { notIn: selections.map((s) => s.kind) } },
  });
  for (const data of selections)
    await tx.itemDictionarySelection.upsert({
      where: { itemId_kind: { itemId, kind: data.kind } },
      create: { itemId, ...data },
      update: data,
    });
}
export function dictionaryIds(
  rows: Pick<ItemDictionarySelection, "kind" | "entryId">[],
) {
  return Object.fromEntries(
    rows.map((s) => [kindKeys[s.kind as DictionaryKind], s.entryId]),
  );
}
