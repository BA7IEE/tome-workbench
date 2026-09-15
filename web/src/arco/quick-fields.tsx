import { currencies } from "../core";
import { dictionaryField } from "../dictionary-picker";
import { sourceFieldNote } from "../item-source-facts";
import { categories, type Item } from "../types";
import { ControllerSlot } from "./runtime";
import { TextField, SelectField } from "./fields";
export function QuickFields({ item }: { item?: Item }) {
  return (
    <>
      <TextField
        name="title"
        label="商品名称"
        value={item?.title || ""}
        required
        placeholder="例如：Dior 羊毛短外套"
      />
      <ControllerSlot
        html={
          dictionaryField(
            "BRAND",
            item?.dictionary?.brand || undefined,
            item?.brand || "",
            item?.brand || "",
          ) + (item ? sourceFieldNote(item, "brand") : "")
        }
      />
      <SelectField
        name="category"
        label="品类"
        choices={categories}
        value={item?.category || "CLOTHING"}
      />
      <div className="quick-intake-price">
        <TextField
          name="price"
          label="对外报价"
          value={item?.currentPrice == null ? "" : item.currentPrice / 100}
          decimal
          placeholder="可留空"
        />
        <SelectField
          name="currency"
          label="币种"
          choices={currencies}
          value={item?.currency || "CNY"}
        />
      </div>
      <ControllerSlot
        html={
          dictionaryField(
            "CONDITION",
            item?.dictionary?.condition || undefined,
            item?.facts.conditionGrade || "",
            item?.facts.conditionGrade || "",
          ) + (item ? sourceFieldNote(item, "condition") : "")
        }
      />
    </>
  );
}
