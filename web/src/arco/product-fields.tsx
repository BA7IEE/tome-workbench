import { Button, Card } from "@arco-design/web-react";
import { can, currencies, money } from "../core";
import { dictionaryField } from "../dictionary-picker";
import { sourceFieldNote } from "../item-source-facts";
import { categories, type Item } from "../types";
import { researchRow, attributeRow, attributeNames } from "../editor-fields";
import { ControllerSlot } from "./runtime";
import { TextField, SelectField, OptionalSection } from "./fields";

export function ProductFields({ item: i }: { item: Item }) {
  const f = i.facts;
  return (
    <>
      <div className="studio-main-column">
        <Card className="studio-title-card" title="商品信息">
          <TextField name="title" label="商品名称" value={i.title} required />
        </Card>
        <div data-media-slot />
        <Card className="studio-description" title="商品描述">
          <TextField
            name="descriptionZh"
            label="中文介绍"
            value={f.descriptionZh}
            multiline={5}
            placeholder="记录这件商品的特点、搭配建议与使用情况"
          />
        </Card>
        <OptionalSection title="尺寸与材质" name="dimensions">
          <div className="form-grid">
            <TextField name="sizeLabel" label="标签尺码" value={f.sizeLabel} />
            <TextField
              name="measurements"
              label="实测尺寸"
              value={f.measurements}
              multiline={2}
            />
            <TextField
              name="measurementSource"
              label="尺寸来源"
              value={f.measurementSource}
            />
            <ControllerSlot
              html={
                dictionaryField(
                  "COLOR",
                  i.dictionary?.color || undefined,
                  f.color,
                  f.color,
                ) + sourceFieldNote(i, "color")
              }
            />
            <ControllerSlot
              html={dictionaryField(
                "MATERIAL",
                i.dictionary?.material || undefined,
                f.mainMaterial || "",
                f.mainMaterial || "",
              )}
            />
            <TextField
              name="material"
              label="材质成分 / 细节"
              value={f.material}
              placeholder="例如：80%羊毛、20%锦纶"
            />
          </div>
        </OptionalSection>
        <OptionalSection title="英文介绍" name="english">
          <TextField
            name="descriptionEn"
            label="英文介绍"
            value={f.descriptionEn}
            multiline={5}
          />
        </OptionalSection>
        <OptionalSection
          title="更多资料 · 年份、设计师、系列"
          name="attributes"
        >
          <ControllerSlot
            id="attribute-rows"
            html={Object.entries(f.attributes)
              .map(([k, v], n) =>
                attributeRow(
                  k,
                  f.attributeLabels?.[k] || attributeNames[k] || k,
                  v,
                  n,
                ),
              )
              .join("")}
          />
          <SelectField
            name="newAttribute"
            label="常用扩展字段"
            choices={{ "": "自定义字段", ...attributeNames }}
          />
          <Button id="add-attribute" htmlType="button">
            ＋ 添加字段
          </Button>
        </OptionalSection>
      </div>
      <aside className="studio-inspector">
        <Card className="studio-classification-card" title="商品归类">
          <ControllerSlot
            html={
              dictionaryField(
                "BRAND",
                i.dictionary?.brand || undefined,
                i.brand,
                i.brand,
              ) + sourceFieldNote(i, "brand")
            }
          />
          <SelectField
            name="category"
            label="品类"
            choices={categories}
            value={i.category}
          />
        </Card>
        <Card className="studio-price-card" title="价格">
          <div className="studio-price">
            <TextField
              name="price"
              label="对外报价"
              value={i.currentPrice == null ? "" : i.currentPrice / 100}
              decimal
              placeholder="暂不定价可留空"
            />
            <SelectField
              name="currency"
              label="币种"
              choices={currencies}
              value={i.currency}
            />
          </div>
          {i.currentCostCny !== undefined && (
            <div className="studio-cost-fact">
              <span>当前人民币成本</span>
              <strong>{money(i.currentCostCny, "CNY")}</strong>
              <small>采购来源与成本依据可在历史中追溯</small>
            </div>
          )}
        </Card>
        <Card className="studio-condition-card" title="成色与品相">
          <ControllerSlot
            html={
              dictionaryField(
                "CONDITION",
                i.dictionary?.condition || undefined,
                f.conditionGrade || "",
                f.conditionGrade || "",
              ) + sourceFieldNote(i, "condition")
            }
          />
          <TextField
            name="condition"
            label="瑕疵与使用痕迹"
            value={f.condition}
            multiline={3}
          />
        </Card>
        <div data-source-slot />
        <OptionalSection title="鉴定与资料" name="authentication">
          {can("review") ? (
            <>
              <SelectField
                name="authStatus"
                label="真实性复核"
                choices={{
                  UNKNOWN: "未确认",
                  PASSED: "通过",
                  FAILED: "存疑 / 未通过",
                }}
                value={f.authentication.status}
              />
              <TextField
                name="authEvidence"
                label="鉴定 / 复核依据"
                value={f.authentication.evidence}
                multiline={2}
              />
              <ControllerSlot
                id="research-rows"
                html={f.research
                  .map((r, n) => researchRow(r, n, true))
                  .join("")}
              />
              <Button id="add-research" htmlType="button">
                ＋ 添加一条资料依据
              </Button>
            </>
          ) : (
            <p>鉴定资料由复核人员确认；日常录货可先保存。</p>
          )}
        </OptionalSection>
        <div data-review-slot />
        <p className="studio-hint">
          只填已知信息即可保存。其他内容以后逐步补充。
        </p>
      </aside>
    </>
  );
}
