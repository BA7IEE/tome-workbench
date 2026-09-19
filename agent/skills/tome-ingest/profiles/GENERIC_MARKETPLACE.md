# Generic Marketplace Profile

版本：`GENERIC_MARKETPLACE/1.1`。适用于没有专用 Profile 的市场来源。它规定字段语义，不规定网页 DOM、CSS selector 或浏览器自动化方式。

## 服务端必查字段

以下路径必须各有一条 `sourceFacts.capture.fields` 检查记录。来源未提供时可以标记 `UNAVAILABLE`，但必须写明原因：

- `titleRaw`
- `sourceItemKey`
- `brandRaw`
- `categoryRaw`
- `conditionRaw`
- `sourceFacts.sizeLabel`
- `sourceFacts.productUrl`
- `sourceFacts.description`
- `sourceCurrentPrice`

`sourceItemKey` 是来源商品稳定标识；`externalKey` 必须在同一来源内稳定、可重采。金额保留来源原币种和原单位，不推导人民币成本或本地售价。

## 图片与证据

记录所有可取得来源图及其实际质量；无图或无法下载必须在图片清单中如实写原因。网页来源使用 `capture.pageUrl`，线下文件使用 `capture.fileEvidence`。不要为了通过检查伪造 URL、文件哈希或图片尺寸。

## 可扩展字段

来源特有字段可原样放进 `sourceFacts` 或 `rawPayload`。新增字段不应覆盖已有人工商品资料，也不应自动成为本地标准字典。

## Agent 整理建议

取得来源事实后，可以按标准 Skill 的 `agentProposal` 合同整理标题、品牌、一级品类、材质、颜色、尺码、尺寸文本和中文介绍。一级品类必须使用协议给出的下拉值；品牌提交来源可支持的名称，由服务端尝试匹配现有字典，不得自动新增标准品牌。每项建议都要引用本候选的来源字段或图片并标记处理方式和置信度；不确定时降低置信度或不建议，不能反写到 `sourceFacts`。
