# Carousell 分发 Profile

版本：`CAROUSELL/1.0`。仅适用于 `channel.platform = CAROUSELL` 的标准交付记录。

- 使用 Channel 默认币种下已冻结的金额；不知道金额时不填 0，也不从其他渠道复制。
- 按冻结的图片位置上传，并保留 `DEFECT` 图；不得替图、删图或推断新的商品事实。
- 仅在外部平台真实提供稳定编号时回传 `remoteId`；否则留空并保留永久 TM 核对说明。
- 发生不确定结果或需要人工处理时报告 `ATTENTION`，不要再次发布或新建资料包。
