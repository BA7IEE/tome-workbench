# AnQiCMS 分发 Profile

版本：`ANQICMS/1.0`。仅适用于 `channel.platform = ANQICMS` 的标准交付记录。

- 冻结资料的 `currency` 必须为 `USD`；不换汇、不把其他渠道金额复制过来。
- 外部 Agent 可在 ToMe 之外使用已获授权的 AnQiCMS MCP/API 完成真实操作；本 Profile
  不规定 Token、端点、请求格式或重试方式。
- 如果外部 MCP/API 返回 archive ID，使用
  `tome_distribution_report_published` 原样回传为 `remoteId`；没有 archive ID 时可留空，
  并在 `note` 说明如何以永久 TM 核对。
- `DELIST` 的标准交付可能只有永久 TM 和 Channel 身份。不得因为旧图片授权失效而阻塞
  停售，也不得伪造 archive ID；已有 archive ID 的售出资料只需 TM、当前状态和该 ID，
  输出 stock=0、保留 SOLD 页面。发布资料中的 `styleNumber`、`condition_grade` 和
  `condition_description` 必须按冻结合同原样使用；具体字段以当前 AnQiCMS 合同为准。
