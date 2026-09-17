# ToMeBoutique 标准采集 Skill

版本：`tome-ingest/1.0`。本 Skill 只规范外部来源事实如何进入候选池；服务端
`/api/agent-ingest` 才是最终合同。它不授予后台账户、商品、库存、成本、成交或发布权限。

## 启动顺序

每次新的导入会话都必须按以下顺序执行，并携带会话给出的
`X-Ingest-Token`；无法自定义该头的 MCP 客户端可改用
`Authorization: Bearer <同一Token>`。

1. `GET /api/agent-ingest/protocol`。
2. 检查协议主版本为 `1`，且当前标准版本至少为 `1.2`；不兼容时停止，不猜测兼容方案。
3. 下载 `skill.url`，核对内容 SHA-256 与 `skill.sha256` 相同。
4. 下载 `profile.url`，核对内容 SHA-256 与 `profile.sha256` 相同。
5. 只按该 Profile 采集来源事实，再创建批次。

不要把旧缓存的 Skill/Profile 用在新会话。Profile 由服务端根据该会话的来源选择，不能自行降级为更宽松的 Profile。

## 只采来源事实

如实记录页面、订单或线下文件中能证明的内容。没有取得的字段写
`UNAVAILABLE` 并写清来源侧原因；不要以常识、模型推断或历史经验补值。

不得决定或写入：正式 TM、库存状态、本地成色/标准字典、真实性、人民币成本、我方售价、图片 PUBLIC 权利、成交、批准或发布。来源状态、来源金额和来源品相只是来源证据。

## 批次与完整性

创建批次的 `rawManifest` 必须包含：

```json
{
  "protocolVersion": "1.2",
  "skillVersion": "tome-ingest/1.0",
  "profile": "服务端 protocol.profile.id",
  "expectedCandidateKeys": [],
  "requiredFields": []
}
```

`requiredFields` 只能增加 Agent 想额外核对的项。服务端会把它与 Profile 的必查项取并集，不能借由少报字段降低检查。

这是所有**新建**机器批次的硬性合同：省略三项标准元数据会被拒绝，不能以
legacy 名义新建批次。只有数据库已存在、且同一来源/批次键/清单完全相同的历史
批次可以按原事实重读或重试。

每件候选都要记录 `sourceFacts.capture`：字段检查、采集时间、网页或文件依据，以及来源图清单。`CAPTURED` 必须有真实提交值；`UNAVAILABLE` 必须有理由。先读取 `GET /batches/:id` 的完整性报告，修复 blocker 后再封批。

## 图片

按以下优先级取得并如实标记：`ORIGINAL`、`LARGEST_AVAILABLE`、`THUMBNAIL`、`UNAVAILABLE`。不得放大缩略图、截图或改编码后冒充来源原图。可取得的文件必须上传现有 multipart 端点，并填写真实 SHA-256、宽度和高度。

来源图默认只作为内部参考证据；下载成功不等于拥有公开发布权。

## 重试与恢复

所有写入都必须有 `Idempotency-Key`。结果未知时，使用**相同请求体和相同 Key**重试；不要新建 Key 猜测服务器是否写入。客户端状态文件只可保存操作 fingerprint、幂等 Key、服务器 ID 和本地状态，绝不保存 Token、Cookie 或第三方凭据。

MCP 是现有 API 的薄入口，只允许读取协议、创建批次、导入订单、写候选、查询批次、封批。图片仍使用 multipart；任何 MCP 工具都不能确认候选、创建 TM、改库存、记成交、确认成本或发布。
