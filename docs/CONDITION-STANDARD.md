# 成色口径与字典规范 · 0.5

本版选择 Vestiaire Collective（VC）公开说明的五级口径作为兔泥巴的初始成色体系。它是明确的海外平台口径，不声称是ISO标准或所有平台共用的分级。

| 稳定编码 | 中文显示 | 英文显示 | 简要含义 |
|---|---|---|---|
| NEVER_WORN_WITH_TAG | 未使用，有原装标签 | Never worn, with tag | 未使用且保留原装标签 |
| NEVER_WORN | 未使用 | Never worn | 从未使用 |
| VERY_GOOD | 非常好 | Very good condition | 有轻微使用痕迹 |
| GOOD | 良好 | Good condition | 有使用痕迹或小瑕疵 |
| FAIR | 一般 | Fair condition | 经常使用或有明显瑕疵 |

中文说明为本系统对官方描述的简体转述，实际判断须结合实物。不以“看着新”代替“从未使用”。具体瑕疵、位置、程度和图片单独维护，选择等级不代表已完成鉴定或图片授权。

## 官方依据（2026-09-12查阅）
- VC中文购物指南，Condition段：https://us.vestiairecollective.com/journal/tw-how-to-buy/
- VC卖家准则，要求原始照片和真实披露瑕疵：https://faq.vestiairecollective.com/hc/en-us/articles/4432094842513-Seller-Guidelines
- The RealReal供应商文档使用另一组条件值，说明跨平台不能仅靠同名自动换算：https://vendor-docs.therealreal.com/attributes/conditions

## 系统行为
品牌、成色等级、颜色、主要材质通过统一字典ID关联。管理员维护名称、英文名、别名、适用品类、排序和启停；成色的五级名称/定义固定于本口径，不允许混入“95新”等自定义级别。
商品保存允许不完整；未知等级留空，不自动评级。已选成色会进入商品修订及渠道资料。英文模板使用所选等级的英文名，但其他未翻译的实物文字仍须人工核对。
材质类别与纤维比例/部位说明分开。只有注册过的品牌/颜色名称或精确别名可被原始文本解析；未知值不自动创建重复项。
字典改名不会反写旧批准快照和旧发布资料。停用不抹掉已选记录，不能在新商品中继续选择停用项。
本版未实现其他平台等级自动映射，也没有按旧商品文本批量猜测/迁移成色。
