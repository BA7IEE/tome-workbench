# ToMeBoutique 标准分发交付 Skill

版本：`tome-distribution/1.0`。本 Skill 只规范外部 Agent 如何取得**冻结**
资料并回填最小结果。ToMeBoutique 不执行闲鱼、Vestiaire、Grailed、Carousell、
AnQiCMS 或其他站点的登录、验证码、页面操作、浏览器/APP 自动化。

## 先确认交付范围

每个 `DistributionSession` 只对应一个具体 Channel。使用一次性受控渠道收到的
`X-Distribution-Token` 调用：

1. `tome_distribution_list_handoffs`，只处理返回的当前 Channel 记录；
2. 按 `channel.platform` 读取仓库中对应 Profile；没有精确 Profile 时停止并请运营人员
   指定，不要自行猜测平台规则；
3. 对要处理的 `recordId` 调用 `tome_distribution_get_package`。此操作把记录从
   “待交付”记为“已交付”，但不代表 ToMe 在外部平台执行任何步骤。

MCP 只有上述读取及两种结果回填工具；同一条记录的取包和回填都要传 12–128 位的
`idempotencyKey`。请求结果不明时，必须使用**原请求和原 key**重试。不要把 Token、
Cookie、密码、验证码、真实账号或平台会话写入状态文件、日志、备注或回传内容。

## 冻结资料合同

`tome_distribution_get_package` 对 `PUBLISH` 或 `UPDATE` 返回：

```json
{
  "recordId": "uuid",
  "action": "PUBLISH",
  "tm": "TM000123",
  "channel": { "id": "uuid", "name": "渠道账号", "platform": "XIANYU" },
  "package": {
    "title": "... TM000123",
    "body": "...",
    "price": 880000,
    "currency": "CNY",
    "images": []
  }
}
```

必须原样使用给定 Channel、永久 TM、标题、正文、价格/币种和图片顺序。`images` 中的
`role`、`position` 与 `sha256` 是冻结资料的一部分：不得隐藏 `DEFECT` 图片、替换图片、
自行补商品事实、改价，或把外部推断写回 ToMe 商品主档。

`price: null` 表示未知，不得填 0 或猜测金额；如果外部渠道不能处理未知价格，回填
`ATTENTION`。`DELIST` 可以返回 `package: null`，只携带永久 TM 和 Channel 身份；这是
有意的 identity-only 停售交付，不能倒推旧资料或要求旧图片仍有授权。

## 结果合同

确认目标操作完成后调用 `tome_distribution_report_published`：

```json
{
  "recordId": "uuid",
  "note": "已确认目标操作完成",
  "remoteId": "",
  "remoteUrl": ""
}
```

`remoteId` 可留空，尤其 APP 没有稳定编号时；不得填写 `MANUAL:TM...` 等伪造 ID。
AnQiCMS 的外部 MCP/API 如果真实返回 archive ID，必须原样回传为 `remoteId`。`DELIST`
使用同一工具表示停售动作已确认完成，不表示新建发布。

外部结果不明、账号状态失效、权限不足或需要人工处理时，调用
`tome_distribution_report_attention`：

```json
{ "recordId": "uuid", "note": "登录状态失效，需要人工处理" }
```

它会把原记录记为“需要核对”（`UNKNOWN`）。之后不得再次取包、再次发布或用新资料覆盖；
运营人员必须在原记录按永久 TM 核对，并人工确认成功或失败。

## 不属于本 Skill 的内容

本 Skill 不规定也不暗示：APP selector、点击坐标、浏览器实现、ADB、Appium、登录、
验证码、爬取、自动重试、平台 HTTP 客户端或页面步骤。任何这类实际操作都属于外部
Agent、脚本或人工自己的受控范围；ToMe 不保存其凭据，也不接收其执行过程。
