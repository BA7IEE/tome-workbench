# The RealReal Profile

版本：`TRR/1.1`。适用于服务器来源代码为 `TRR`、`TRR-...` 或 `TRR_...` 的会话。它只保存 The RealReal 的来源事实，不把来源状态、价格或品相变成本地经营决定。

## 商品必查字段

以下路径必须在 `sourceFacts.capture.fields` 中逐项记录已取得或来源不可得的原因：

- `titleRaw`
- `sourceItemKey`
- `brandRaw`
- `categoryRaw`
- `conditionRaw`
- `sourceFacts.sizeLabel`
- `sourceFacts.color`
- `sourceFacts.material`
- `sourceFacts.measurements`
- `sourceFacts.productUrl`
- `sourceFacts.description`
- `sourceLineAmount`
- `sourceLineNetAmount`
- `sourceCurrentPrice`
- `sourceEstimatedRetail`

其中 `conditionRaw` 是页面实际显示的单件等级，瑕疵/品相原文放在 `sourceFacts.conditionDescription` 或 `sourceFacts.description`；不要把一整套平台等级选项当成单件描述。

## 订单事实

订单导入应如实保留外部订单号、下单时间、每个 line item、订单行原价、订单行折后金额、支付、Store Credit、运费、折扣、税费、退款、RMA 和物流状态。`sourceLineAmount` 是商品原价，`sourceLineNetAmount` 是订单逐件折扣后、整单运费和 Store Credit 之前的商品金额；`sourceCurrentPrice` 只用于网页另行显示的当前平台价。三者不能互相冒充。估计零售价及后续人民币取得成本也分别保存；未知金额留空。

## 图片

逐件记录所有可取得原图。若只能取得最大可用图或缩略图，按真实质量标记并说明限制；禁止从截图、拼图或放大缩略图伪造 ORIGINAL。图片上传后仍是内部 REFERENCE 证据，不能自动公开发布。
