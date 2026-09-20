# ToMeBoutique 标准采集 Skill

版本：`tome-ingest/1.2`。本 Skill 规范外部来源事实和可选的 Agent 整理建议如何进入候选池；服务端
`/api/agent-ingest` 才是最终合同。它不授予后台账户、商品、库存、成本、成交或发布权限。

## 启动顺序

每次新的导入会话都必须按以下顺序执行，并携带会话给出的
`X-Ingest-Token`；无法自定义该头的 MCP 客户端可改用
`Authorization: Bearer <同一Token>`。

1. `GET /api/agent-ingest/protocol`。
2. 检查协议主版本为 `1`，且当前标准版本至少为 `1.2`；不兼容时停止，不猜测兼容方案。
3. 下载 `skill.url`，核对内容 SHA-256 与 `skill.sha256` 相同。
4. 下载 `profile.url`，核对内容 SHA-256 与 `profile.sha256` 相同。
5. 只按该 Profile 采集来源事实；如需整理，另行生成 `agentProposal`，再创建批次。

不要把旧缓存的 Skill/Profile 用在新会话。Profile 由服务端根据该会话的来源选择，不能自行降级为更宽松的 Profile。

## 来源事实和 Agent 建议必须分开

如实记录页面、订单或线下文件中能证明的内容。没有取得的字段写
`UNAVAILABLE` 并写清来源侧原因；不得用常识、模型推断或历史经验把来源缺项改成 `CAPTURED`。

外部 Agent 可以基于已经提交的文字和图片，按 `GET /protocol` 返回的 `agentProposal.fields`
生成面向 ToMe 字段的整理建议。下拉字段必须提交服务端列出的选项值；填写字段必须遵守长度和格式。
每项建议都必须记录目标路径、建议值、处理方式、0–1 置信度，以及实际引用的来源字段路径或来源图片
SHA-256。`EXTRACTED` 是直接提取，`NORMALIZED` 是格式或选项规范化，`TRANSLATED` 是翻译，
`INFERRED` 是需要人工重点复核的判断。不能把置信度高写成来源已提供，也不能虚构依据。

示例：

```json
{
  "agentProposal": {
    "generator": "LLM",
    "model": "实际使用的模型名",
    "generatedAt": "2026-09-20T08:00:00.000Z",
    "fields": [
      {
        "path": "category",
        "value": "BAG",
        "method": "NORMALIZED",
        "confidence": 1,
        "evidencePaths": ["categoryRaw"],
        "evidenceImageSha256": [],
        "note": "来源分类明确对应包袋"
      },
      {
        "path": "facts.descriptionZh",
        "value": "根据已采集资料整理的中文介绍",
        "method": "TRANSLATED",
        "confidence": 0.86,
        "evidencePaths": ["sourceFacts.description", "sourceFacts.material"],
        "evidenceImageSha256": [],
        "note": "需人工核对品牌术语"
      }
    ]
  }
}
```

`agentProposal` 不参与来源完整性判定，也不能出现在 `requiredFields` 或
`sourceFacts.capture.fields` 中。服务端会验证字段类型、下拉选项、格式限制和图片引用；人工确认候选前，
建议不会成为正式 TM 事实。模型没有足够依据时可以不提交该字段，不能为凑齐字段而猜测。

不得决定或写入：正式 TM、库存状态、本地成色/标准字典、真实性、人民币成本、我方售价、图片 PUBLIC 权利、成交、批准或发布。来源状态、来源金额和来源品相只是来源证据。

## 显式纠正已有来源事实

普通的省略字段或 `null` 仍表示“本次没有新值”，服务端会保留已经采集的来源事实，防止稀疏重试误删资料。只有确认旧的 `sourceCurrentPrice` 不是网页另行显示的当前平台价时，才可提交：

```json
{
  "sourceCurrentPrice": null,
  "sourceCorrection": {
    "clearFields": ["sourceCurrentPrice"],
    "reason": "此前误把订单行折后金额写入来源现价"
  }
}
```

同一候选的 `sourceFacts.capture.fields` 必须同时把 `sourceCurrentPrice` 标记为 `UNAVAILABLE`，并写清网页、订单或文件为什么不能证明当前平台价。服务端会拒绝“仍标记 CAPTURED”“没有来源侧原因”“非空金额”或尝试清空其他字段的请求。纠错会进入候选修订快照；它不会改写订单行原价、订单行折后金额、TM、库存或成本。

## 批次与完整性

创建批次的 `rawManifest` 必须包含：

```json
{
  "protocolVersion": "1.2",
  "skillVersion": "tome-ingest/1.2",
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

## 凭据与敏感来源数据

导入会话 Token 只在首次创建成功时显示，不能依赖同一个创建请求再次取回。会话创建者被停用、失去货源权限，或来源被停用后，旧 Token 必须视为立即失效。

不得把第三方密码、Cookie、Authorization、Token、API Key、Session、Signature 或其他访问凭据写入 `rawPayload`、`sourceFacts`、URL、备注或字段名。遇到 signed URL 时，Agent 可以在外部执行环境用它下载真实文件，但提交到 ToMe 的来源 URL 必须去掉敏感查询参数。

## 重试与恢复

所有写入都必须有 `Idempotency-Key`。结果未知时，使用**相同请求体和相同 Key**重试；不要新建 Key 猜测服务器是否写入。客户端状态文件只可保存操作 fingerprint、幂等 Key、服务器 ID 和本地状态，绝不保存 Token、Cookie 或第三方凭据。

MCP 是现有 API 的薄入口，只允许读取协议、创建批次、导入订单、写候选、查询批次、封批。图片仍使用 multipart；任何 MCP 工具都不能确认候选、创建 TM、改库存、记成交、确认成本或发布。
