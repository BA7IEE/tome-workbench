import { currencies } from "../core";
import { dictionaryField } from "../dictionary-picker";
import { sourceFieldNote } from "../item-source-facts";
import { categories, type Item } from "../types";
import { ControllerSlot } from "./runtime";
import { TextField, SelectField } from "./fields";
import type { IntakeInput } from "../quick-intake-attempt";
export function QuickFields({
  item,
  input,
}: {
  item?: Item;
  input?: IntakeInput;
}) {
  const values = input || item;
  return (
    <>
      <TextField
        name="title"
        label="商品名称"
        value={values?.title || ""}
        required
        placeholder="例如：Dior 羊毛短外套"
      />
      <ControllerSlot
        html={
          dictionaryField(
            "BRAND",
            values?.dictionary?.brand || undefined,
            values?.brand || "",
            item?.brand || "",
          ) + (item ? sourceFieldNote(item, "brand") : "")
        }
      />
      <SelectField
        name="category"
        label="品类"
        choices={categories}
        value={values?.category || "CLOTHING"}
      />
      <div className="quick-intake-price">
        <TextField
          name="price"
          label="对外报价"
          value={values?.currentPrice == null ? "" : values.currentPrice / 100}
          decimal
          placeholder="可留空"
        />
        <SelectField
          name="currency"
          label="币种"
          choices={currencies}
          value={values?.currency || "CNY"}
        />
      </div>
      <ControllerSlot
        html={
          dictionaryField(
            "CONDITION",
            values?.dictionary?.condition || undefined,
            values?.facts.conditionGrade || "",
            item?.facts.conditionGrade || "",
          ) + (item ? sourceFieldNote(item, "condition") : "")
        }
      />
    </>
  );
}
