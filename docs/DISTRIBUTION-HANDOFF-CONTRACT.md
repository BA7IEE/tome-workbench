# 标准分发交付合同

当前版本：`1.1.0-rc.6`。ToMeBoutique 是商品事实中心：它冻结资料、按 Channel
交付并记录最小经营状态；外部 Agent、脚本或人工才完成平台上的实际操作。它不包含
闲鱼、Vestiaire、Grailed、Carousell、AnQiCMS 或其他渠道的登录、验证码、页面步骤、
浏览器/APP 自动化、HTTP Connector 或真实第三方写入。

## 范围和会话

后台用户从有效 `UsePackage` 生成分发记录，再创建只对应**一个具体 Channel** 的
`DistributionSession`。数据库、Audit、Receipt 只保存 Token 哈希；明文 Token 只在创建
响应出现一次。每个机器请求使用 `X-Distribution-Token` 或同一 Token 的 Bearer 头，系统会核验会话未撤销/过期、
创建者仍启用且仍具 `publish` 权限。停用或退出 `TRADE` 的 Channel 不再交付新的
PUBLISH/UPDATE；只有仍有未完成 DELIST 时可以创建 stop-only Session，且其列表和取包
只能处理 DELIST，全部确认停售后不能再创建会话。历史渠道没有专用发布 Profile 时，
stop-only Session 使用 `GENERIC_STOP/1.0` 合同，只允许按永久 TM / 已知远端身份完成
DELIST，不因此开放新的交易发布能力。

同一 Token 也可用 `Authorization: Bearer <token>`。这是两种等价的机器认证写法，不是
额外凭据，也不得同时扩展为平台登录或执行权限。

## 发现与校验

执行方先读取 `GET /api/distribution-agent/protocol`。响应按当前会话的 Channel 返回：

- `skill`：`tome-distribution/1.0` 的 ID、版本、SHA-256 和 `/skill` URL；
- `profile`：该平台精确 Profile 的 ID、SHA-256 和 `/profile` URL；
- 四个标准 Handoff 工具的固定名单。

再以同一机器 Token 下载 `GET /api/distribution-agent/skill` 与 `GET
/api/distribution-agent/profile`。对原始 Markdown 字节计算 SHA-256，必须与 protocol
响应一致才可继续；没有精确 Profile 时服务拒绝交付，不能猜测平台规则。MCP 的
`initialize` 返回同一份 Skill/Profile 元数据。两份文档均为 `private, no-store`。

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
  },
  "platformData": null
}
```

它只来自有效、未过期的 `UsePackage`：标题、正文、价格/币种、图片顺序和权利会重新
校验。外部执行方必须原样使用，不得隐藏瑕疵图、改价、补写商品事实或把外部推断写回
主档。`price: null` 就是未知，交易资料也不能填 0 或自动换汇。使用包到期只阻止这一次
新的取包；已经确认发布的远端暴露会另按当前安全事实检查，不会因为 TTL 自身变成更新。

`DELIST` 可返回 `package: null`。它只交付永久 TM 与 Channel 身份，以便外部执行方
停止出售；不会反向构造历史包，也不会因历史图片权利失效而阻塞停售。

当 `channel.platform = ANQICMS` 时，取包额外返回
`platformData: { schema: "tome.anqicms/v1", payload: ... }`。其中 `payload` 直接复用
现有本地 AnQiCMS 合同 builder，不是 HTTP Connector、平台请求或浏览器步骤。已有 archive
ID 的停售固定为 identity-only `STOCK_ZERO`：只读取 TM、当前库存状态、Channel 和
archive ID，输出 `stock=0`、保留 SOLD 页面且关闭 Checkout。它不读取历史图片、文案、USD
报价或 UsePackage；发布/更新资料则使用冻结包的 USD、`styleNumber` 以及分开的成色等级/
瑕疵说明。字段细节见 [ANQICMS-CONTRACT](integrations/ANQICMS-CONTRACT.md)。

## 最小结果

确认目标操作完成：

```http
POST /api/distribution-agent/handoffs/:recordId/published
Idempotency-Key: <12-128 chars>
```

```json
{ "note": "已确认目标操作完成", "remoteId": "", "remoteUrl": "" }
```

APP 没有稳定编号时，`remoteId` 可留空，并在 `note` 中说明以永久 TM 的核对依据。禁止
`MANUAL:TM...` 等伪造 ID。若同一 Item×Channel 已有唯一 LIVE 稳定远端身份，`UPDATE`
必须继续指向该身份；本次不重复返回 ID 时系统可继承唯一已知身份，但返回不同 ID 或存在
多个 LIVE 身份会被阻断并要求人工核对，不能把 UPDATE 静默变成第二个远端商品。AnQiCMS 的
`PUBLISH` 和 `UPDATE` 成功必须把外部 MCP/API 真实返回的稳定 `archive_id` 原样回传为
`remoteId`；空值、TM、手工占位或凭据文本都会拒绝，不能生成“无 ID 成功”。对 `DELIST`，
`published` 表示停售目标已确认完成。

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

若标准 Handoff 已交付超过 `DISTRIBUTION_HANDOFF_STALE_HOURS`（默认 24，允许 1–168）或
绑定会话已撤销/过期，经营投影只会动态显示 `ATTENTION`（分别为 `HANDOFF_STALE`、
`HANDOFF_SESSION_DEAD`）。原 Attempt 仍是 `RUNNING`，不会自动重发、重取包、换会话或改写
Audit/Receipt；运营人员必须按永久 TM 核对原记录。

## MCP

`POST /api/mcp/distribution` 是同一服务的薄 JSON-RPC MCP 入口，只提供：

- `tome_distribution_list_handoffs`
- `tome_distribution_get_package`
- `tome_distribution_report_published`
- `tome_distribution_report_attention`

它不暴露领取、心跳、续租、重试调度、浏览器步骤或平台操作工具。旧
`/api/distribution-agent/attempts/*` 的领取/租约接口仍为兼容保留的高级面，但
`DISTRIBUTION_COMPAT_RUNTIME_ENABLED=false` 是默认配置；关闭时这些路径统一返回
`410 COMPAT_DISTRIBUTION_RUNTIME_DISABLED`。仅在受控兼容迁移中显式设为 `true` 才可使用，
不能作为默认产品流程或平台 Runtime 的描述。

实际平台账号、凭据、支付、订单、真实 archive ID 回传和经营验收均在 ToMe 外部；本地
自动化只使用 `tome_test` 合成资料，不能替代这些验收。
