# 标准分发交付合同

当前版本：`1.1.0-rc.4`。ToMeBoutique 是商品事实中心：它冻结资料、按 Channel
交付并记录最小经营状态；外部 Agent、脚本或人工才完成平台上的实际操作。它不包含
闲鱼、Vestiaire、Grailed、Carousell、AnQiCMS 或其他渠道的登录、验证码、页面步骤、
浏览器/APP 自动化、HTTP Connector 或真实第三方写入。

## 范围和会话

后台用户从有效 `UsePackage` 生成分发记录，再创建只对应**一个具体 Channel** 的
`DistributionSession`。数据库、Audit、Receipt 只保存 Token 哈希；明文 Token 只在创建
响应出现一次。每个机器请求使用 `X-Distribution-Token`，系统会核验会话未撤销/过期、
创建者仍启用且仍具 `publish` 权限。

标准路径是：

1. `GET /api/distribution-agent/handoffs` 列出当前渠道 `PENDING` 和本会话已交付的
   `RUNNING` 记录；
2. `POST /api/distribution-agent/handoffs/:recordId/package`，带 `Idempotency-Key`，取得
   冻结资料并把该记录记为 `RUNNING`（已交付）；
3. 外部执行方在自身受控范围完成目标渠道操作；
4. 只用 `published` 或 `attention` 回传最小结果。

机器写操作在同一事务写入 Receipt、Audit 和 Outbox。相同 key + 不同载荷冲突；每次
重放在读取 Receipt 前重新检查会话和创建者权限。`GET /assets` 仅允许取得已交付给本
会话的冻结包中的图片。

## 冻结资料

对 `PUBLISH` 或 `UPDATE`，取包响应为：

```json
{
  "recordId": "uuid",
  "action": "PUBLISH",
  "tm": "TM000123",
  "channel": { "id": "uuid", "name": "闲鱼主号", "platform": "XIANYU" },
  "package": {
    "title": "... TM000123",
    "body": "...",
    "price": 880000,
    "currency": "CNY",
    "images": [
      { "id": "uuid", "role": "DEFECT", "position": 2, "sha256": "...", "download": "/api/..." }
    ]
  }
}
```

它只来自有效、未过期的 `UsePackage`：标题、正文、价格/币种、图片顺序和权利会重新
校验。外部执行方必须原样使用，不得隐藏瑕疵图、改价、补写商品事实或把外部推断写回
主档。`price: null` 就是未知，不能填 0 或自动换汇。

`DELIST` 可返回 `package: null`。它只交付永久 TM 与 Channel 身份，以便外部执行方
停止出售；不会反向构造历史包，也不会因历史图片权利失效而阻塞停售。

## 最小结果

确认目标操作完成：

```http
POST /api/distribution-agent/handoffs/:recordId/published
Idempotency-Key: <12-128 chars>
```

```json
{ "note": "已确认目标操作完成", "remoteId": "", "remoteUrl": "" }
```

`remoteId` 可选；APP 没有稳定编号时留空，并在 `note` 中说明以永久 TM 的核对依据。
禁止 `MANUAL:TM...` 等伪造 ID。AnQiCMS 外部 MCP/API 真实返回 archive ID 时，应原样
回传为 `remoteId`。对 `DELIST`，`published` 表示停售目标已确认完成。

外部结果不明或需要人工处理：

```http
POST /api/distribution-agent/handoffs/:recordId/attention
Idempotency-Key: <12-128 chars>
```

```json
{ "note": "登录状态失效，需要人工处理" }
```

这会把原记录标为 `UNKNOWN`（需要核对）。标准 Agent 不能再次取包或将它回填为成功；
运营人员必须在原记录按永久 TM 核对，并人工确认 `SUCCEEDED` 或 `FAILED`。

## MCP

`POST /api/mcp/distribution` 是同一服务的薄 JSON-RPC MCP 入口，只提供：

- `tome_distribution_list_handoffs`
- `tome_distribution_get_package`
- `tome_distribution_report_published`
- `tome_distribution_report_attention`

它不暴露领取、心跳、续租、重试调度、浏览器步骤或平台操作工具。旧
`/api/distribution-agent/attempts/*` 的领取/租约接口仍为兼容保留的高级面，不能作为
默认产品流程或平台 Runtime 的描述。

实际平台账号、凭据、支付、订单、真实 archive ID 回传和经营验收均在 ToMe 外部；本地
自动化只使用 `tome_test` 合成资料，不能替代这些验收。
