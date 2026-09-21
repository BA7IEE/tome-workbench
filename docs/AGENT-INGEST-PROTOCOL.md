# 通用 Agent 导入协议

## 目的
ToMeBoutique 不内置网页采集机器人。Codex、WorkBuddy、自研脚本或其他桌面 Agent 都通过同一协议把外部来源事实提交到“待确认商品池”。

后台人员在「导入记录 → 外部工具接入」（旧待确认入口仍保留）创建短期导入会话。Token 只显示一次，不等于后台账号，也不继承管理员权限。

## 请求约定
Agent 请求使用下列其中一种令牌头：

- `X-Ingest-Token: <短期Token>`
- 或 `Authorization: Bearer <同一短期Token>`（无法设置自定义头的 MCP 客户端）；同时发送时以 `X-Ingest-Token` 为准
- 所有写请求必须带 `Idempotency-Key`
- Base URL：`/api/agent-ingest`

网络回执中断时，必须使用**同一个 Idempotency-Key 和同一请求内容**重试；不要生成新请求号来猜测是否成功。

创建导入会话本身是凭据签发动作：Token 只在首次成功响应中显示，服务端 Receipt 只保存 `tokenIssued=true`，不会保存明文 Token。相同创建请求如果因网络中断再次提交，服务端不会重放明文 Token，而会返回 `TOKEN_ALREADY_ISSUED`；经营人员应从会话列表确认该会话并在需要时撤销后重新创建。机器会话每次访问都会重新核验创建者仍启用且保有 `supply` 权限、来源仍启用；任一条件失效后旧 Token 立即停止使用。

## 推荐流程
1. `GET /protocol`，读取当前协议、Skill 和本会话来源 Profile。
2. 校验协议主版本、Skill/Profile SHA-256；不兼容时停止写入。
3. `POST /batches` 创建采集批次。
4. `POST /orders` 提交来源订单事实；没有订单的来源可跳过。
5. `POST /batches/:id/candidates` 批量提交商品候选。
6. `POST /candidates/:id/assets` 上传已下载的来源图片原件。
7. `POST /batches/:id/seal` 封闭批次。

封批后批次不可继续增加候选或图片；重新采集同一外部商品使用稳定 `externalKey`，系统追加修订而不是制造第二件候选。
## 候选商品必须提供的稳定信息
每个候选至少需要稳定 `externalKey` 和商品名称。建议同时提交：来源货号、品牌原文、品类路径、来源成色/状态、订单行金额、平台现价、估计零售价、尺码、颜色、材质、尺寸、描述、来源 URL、原始 JSON。

这些字段是**来源事实**。Agent 不应替经营中台决定：本地标准成色、本地库存状态、商品售价、人民币成本、图片公开授权或是否成交。

## 图片
图片以 multipart/form-data 上传。中台保存原文件并按 SHA 去重；确认 TM 时复用原文件，不要求 Agent 再下载一次。

Agent 导入图默认转为 TM 的 `REFERENCE / INTERNAL / 未核验` 素材。公开销售前是否可使用仍由人工核对授权。

## 敏感资料边界

来源事实可以保留广泛的商品、订单和页面字段，但**不能把采集接口当凭据仓库**。机器写入会拒绝明显的 `password`、`token`、`cookie`、`authorization`、`api_key`、`session`、`signature` 等凭据字段，也拒绝用户名/密码 URL 及带访问签名、Token、Cookie 或密钥查询参数的 URL。外部 Agent 可以使用带签名的临时 URL 在自己的环境中下载素材，再把实际文件上传；提交给 ToMe 的来源地址必须去掉敏感访问参数。

## 权限边界
短期 Token 只能访问 `/api/agent-ingest`。它不能访问普通 `/api/items`、成交、库存、成本、账号、发布等后台写接口。

Agent 导入成功只意味着“来源事实已进入候选池”，不意味着正式商品已经入库。只有后台人员批量确认后才生成永久 TM 编号。

## 批量规模
后台“待确认”每页真实支持最多 100 件，适合历史订单批量处理。第101件及以后进入下一页，不通过隐藏截断冒充100件处理。

详细字段结构以当前 OpenAPI/接口 schema 为准；Agent 应先读取当前协议，不把某个平台页面结构硬编码成中台业务规则。
## 1.1 完整性清单（rc.6）

`GET /api/agent-ingest/protocol`返回当前接入提示。以下JSON示例均为合成资料；客户端必须使用真实采集结果替换。

创建批次的rawManifest新增预期商品键与必查字段。每批最多声明20000件，每次候选写入最多200件；建议按可恢复的规模拆批。

```json
{
  "externalBatchKey": "supplier-history-part-001",
  "agentName": "External Collector",
  "kind": "ORDER_HISTORY",
  "rawManifest": {
    "protocolVersion": "1.2",
    "skillVersion": "tome-ingest/1.2",
    "profile": "服务端 protocol.profile.id",
    "expectedCandidateKeys": ["supplier:order-001:sku-001"],
    "requiredFields": ["titleRaw", "sourceFacts.description", "sourceFacts.sizeLabel"]
  }
}
```

候选中sourceFacts保留全部来源参数，capture为结构化采集证据。每项field.path以候选为根，支持点分路径（如sourceFacts.measurements.Bust）；CAPTURED必须有实际值，来源缺失用UNAVAILABLE并给出reason。页面上出现的未知字段也须原样保留，不限于中台已有标准字典。

```json
{
  "candidates": [{
    "externalKey": "supplier:order-001:sku-001",
    "sourceItemKey": "sku-001",
    "titleRaw": "Synthetic Silk Dress",
    "currency": "USD",
    "sourceFacts": {
      "description": "Original source description",
      "material": "100% Silk",
      "measurements": {"Bust": "37 in"},
      "capture": {
        "pageUrl": "https://example.invalid/product-001",
        "capturedAt": "2026-09-14T00:00:00.000Z",
        "fields": [
          {"path": "titleRaw", "label": "商品名称", "status": "CAPTURED"},
          {"path": "sourceFacts.description", "label": "商品介绍", "status": "CAPTURED"},
          {"path": "sourceFacts.sizeLabel", "label": "来源展示尺码", "status": "UNAVAILABLE", "reason": "来源页面未提供"}
        ],
        "images": [{
          "sourceUrl": "https://example.invalid/original.png",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "width": 1500,
          "height": 2000,
          "quality": "ORIGINAL"
        }]
      }
    },
    "agentProposal": {
      "generator": "LLM",
      "model": "实际使用的模型名",
      "generatedAt": "2026-09-14T00:01:00.000Z",
      "fields": [
        {
          "path": "category",
          "value": "CLOTHING",
          "method": "NORMALIZED",
          "confidence": 1,
          "evidencePaths": ["categoryRaw"],
          "evidenceImageSha256": [],
          "note": "按系统下拉选项规范化"
        },
        {
          "path": "facts.descriptionZh",
          "value": "根据来源原文整理的中文商品介绍。",
          "method": "TRANSLATED",
          "confidence": 0.9,
          "evidencePaths": ["sourceFacts.description", "sourceFacts.material"],
          "evidenceImageSha256": [],
          "note": "品牌术语仍需人工复核"
        }
      ]
    },
    "rawPayload": {"synthetic": true}
  }]
}
```

`agentProposal` 是可选的字段级整理建议，不是来源事实。`GET /protocol` 返回允许的目标路径、输入类型、
下拉选项、长度和格式；服务端拒绝未知目标、非法选项、重复目标、超长值、无依据建议，以及引用未列入
`sourceFacts.capture.images` 的图片。每项 `method` 必须是 `EXTRACTED`、`NORMALIZED`、
`TRANSLATED` 或 `INFERRED`，`confidence` 为 0–1。来源字段缺失时，即使 Agent 给出建议，仍必须在
`capture.fields` 中写 `UNAVAILABLE + 原因`，且完整性报告继续显示缺项。

历史候选若曾误把订单行金额写入来源现价，不能靠普通 `null` 或漏传字段删除。重新核对后可在候选中显式提交：

```json
{
  "sourceCurrentPrice": null,
  "sourceCorrection": {
    "clearFields": ["sourceCurrentPrice"],
    "reason": "此前误把订单行折后金额写入来源现价"
  }
}
```

同时，`sourceFacts.capture.fields` 中的 `sourceCurrentPrice` 必须为带来源侧原因的 `UNAVAILABLE`。当前合同只允许清空 `sourceCurrentPrice`；非空金额、仍标记 `CAPTURED`、没有理由或尝试清空其他金额都会拒绝。纠错原因保存在候选修订快照中，不改变订单行原价、订单行折后金额、TM、库存、成本或其他经营事实。

人工确认候选时，系统才把已展示的建议用于正式 TM 的名称、已存在品牌匹配、一级品类、材质、颜色、
尺码、尺寸文本和中文介绍。Agent 不能建议或写入 TM 身份、库存、本地成色等级、真实性、人民币成本、
售价、成交、图片公开权或发布。品牌建议只尝试匹配现有字典，不自动创建标准词；品类必须使用协议返回的
枚举。存疑或推断项必须降低置信度并说明原因，后台会单独展示以便人工重点复核。

图片quality：ORIGINAL原图；LARGEST_AVAILABLE来源可取得最大图（说明依据）；THUMBNAIL仅缩略图；UNAVAILABLE未取得（后两者必须说明原因）。除UNAVAILABLE外须填写实际文件sha256、width、height。后端保留上传字节，并核对实际文件尺寸；不要放大缩略图冒充原图。每候选最多100个字段检查和100张图；来源有更多内容时应明确报告，不能悄悄截断。

`GET /batches/:id`新增integrity报告，包含预期/收到件数、逐件问题及封批阻断项。缺商品、文件或字段检查、标记已取但未传值、尺寸不符会使封批返回409。来源缺失或仅缩略图可封批但保持GAPS，需后台单件说明后确认；COMPLETE表示声明内检查完成，UNVERIFIED表示无有效清单，不能声称已收齐远端全部内容。原文件存储是保证上传字节不改，不是独立鉴定图片最高质量。

原文件入口：`GET /api/ingest/candidate-assets/:id/original`，普通登录的内部读权限；关联素材变为内部凭证后重查财务权限。机器Token不能用于后台文件读取或商品/库存/成本写操作。预览与原件均不公开缓存。

同externalBatchKey重新创建必须使用相同rawManifest；改变清单应新建批次。封批不能继续写，重新采集用新批次和稳定externalKey；已有候选更新来源修订而不新建TM。稀疏补充保留已有非空来源字段、递归参数和人工建议，capture整体替换以表达本次检查。已确认商品的新来源图停留在候选证据层，不自动修改Item素材或公开授权。历史来源原文保存在修订中；除上述受限 `sourceCorrection` 外，不能用漏传字段或普通 `null` 删除旧值。

后台批量接口仍每次最多100件，新增可选versions映射（候选ID到看到的版本）。新版界面跨页最多选1000件并自动分段。每段及重试使用固定幂等键、固定ID顺序与版本；部分失败有逐件原因。旧客户端未传versions保持兼容，新客户端必须传以保护人工看到的版本。

### 来源品相说明
`sourceFacts.conditionDescription`（或兼容的`conditionNotes`）用于单件品相/瑕疵原文，不应把平台的全部成色等级选项拼作单件说明。`conditionRaw`保存页面实际选中等级。确认新TM时将来源品牌、平台名和品相说明（最多1000字符的展示快照，完整原文仍在sourceFacts）保存在来源扩展资料；人工成色等级仍须单独确认。

多来源字段映射、原文、身份和成本政策的约定见[MULTI-SOURCE-DESIGN.md](MULTI-SOURCE-DESIGN.md)。来源ID隔离externalKey；新候选省略currency时采用来源默认币种，后续稀疏修订省略时保持已有币种。适配器应尽量显式传入实际原币，来源币种不推导人民币成本。


## 1.2 文件来源和批次历史（rc.15）

网页来源继续使用 capture.pageUrl。线下表格、网盘整理等没有商品网页时，可使用 capture.fileEvidence={name,sha256,row}，name 为原文件名、sha256 为64位十六进制校验值、row 为记录位置（表格行、文件内编号等）。图片记录可用 sourceFile 替代 sourceUrl；保留 sha256/width/height 等原有完整性字段及实际上传要求，不为通过校验伪造网址。fileEvidence 的文件摘要是提交的来源证据；只有实际上传的图片会进行服务端文件校验，未上传表格本体不宣称已独立核验。

普通后台 GET /api/ingest/batch-records?q=...&page=1 每页30批，返回来源、批次和当前决定计数。GET /api/ingest/candidates?batchId=... 按历史成员进入本批。第二批补采增加成员关系，旧批次不会消失；已封批的完整性核对使用封批时审计，候选详情展示最新来源修订。升级仅补已有候选当前可证明的成员关系，不恢复曾被覆盖的未知旧历史。

普通后台 bulk-confirm 可携带 incompleteAcknowledgements:{候选ID:核对依据}，每条依据不少于3字，并且必须属于本次 ids 和对应 versions。界面先集中展示合法 GAPS 再显式勾选和填写；缺少预期原文件、文件不符、身份疑问等阻断仍由共享确认规则拒绝。机器 token 无权确认。

批量可选择最多1000件，每100件提交，完成回执逐段保留。关闭后回到原浏览器、同一账号可以继续原请求，成功项不重复建档。服务器事实和错误结果与本地恢复进度分开；清理浏览器数据会失去待重试输入，应从批次实际结果重新核对。


## UX 1.0.1 确认状态

机器导入权限没有扩展。后台新 UI 的单件/批量确认默认待整理 PAUSED；后台 bulk-confirm 未提供 status 时也默认 PAUSED，显式 status=AVAILABLE 仍支持。实物在手与可售分别确认。单件 confirm 的旧默认值与说明保持兼容，UI 始终显式提交状态和说明；旧客户端应明确传 status 表达意图。原结果未知的请求使用原状态、版本、缺项说明和幂等键恢复，不在重试时替换为新默认值。

## 1.2 标准 Agent Ingest

`/api/agent-ingest` 仍是唯一服务端写入合同；v1.2 只统一 Skill、来源 Profile、MCP 和 CLI 的使用方式，不重写候选、TM、库存、成本、成交或发布模型。

### 启动校验

机器会话先读取 `GET /api/agent-ingest/protocol`。响应包含：

```json
{
  "version": "1.2",
  "skill": {
    "name": "tome-ingest",
    "version": "1.2",
    "id": "tome-ingest/1.2",
    "sha256": "…",
    "url": "/api/agent-ingest/skill"
  },
  "profile": {
    "id": "TRR/1.4",
    "sha256": "…",
    "url": "/api/agent-ingest/profile",
    "requiredFields": ["titleRaw"]
  }
}
```

随后读取 `skill.url` 与 `profile.url`，以 `text/markdown` 返回，并核对 SHA-256。协议主版本不是 `1`、标准版本低于 `1.2`、下载内容或来源 Profile 不匹配时必须停止写入。新建 `TRR`、`TRR-...`、`TRR_...` 来源批次使用 `TRR/1.4`；已存在的 `TRR/1.3` 批次只按其原合同读取或重放，不能新建或改写为旧 Profile。其他当前来源使用 `GENERIC_MARKETPLACE/1.2`。Profile 由服务器选择，机器不能自行降级。

### 批次元数据与完整性

标准客户端创建批次时将以下内容放入 `rawManifest`：

```json
{
  "protocolVersion": "1.2",
  "skillVersion": "tome-ingest/1.2",
  "profile": "TRR/1.4",
  "expectedCandidateKeys": [],
  "requiredFields": []
}
```

`requiredFields` 仅用于增加本次采集检查。封批时实际必查字段为 **当前 Profile 的服务端必查字段 ∪ 本 Manifest 声明字段**。所有字段都需要在 `sourceFacts.capture.fields` 里记录 `CAPTURED` 或带原因的 `UNAVAILABLE`；不能用删掉检查项降低合同。新机器批次缺少三项标准元数据、Profile 错配、Skill 版本错误或协议不兼容都会在创建时拒绝。只有数据库已经存在且同一来源、批次键、清单完全相同的历史批次可以继续按旧合同读取或重放；新 Agent 不能靠省略 metadata 当作 legacy。

### 标准资料目录

- `agent/skills/tome-ingest/SKILL.md`：所有 Agent 的行为边界、图片优先级、重试和封批顺序。
- `agent/skills/tome-ingest/profiles/GENERIC_MARKETPLACE.md`：通用市场来源语义。
- `agent/skills/tome-ingest/profiles/TRR.md`：TRR 商品、订单和图片语义。

Profile 规定字段含义，不存放网页 selector、第三方 Cookie、账号或凭据。

### TRR/1.4 尺码与购买日期来源事实

`sourceFacts.sizeLabel` 仅是 TRR 页面显示的尺码，不能作为品牌或实物标签尺码。来源明确显示品牌/标签原始尺码时才写入 `sourceFacts.foreignSize`；没有时必须在 `capture.fields` 中把该路径标为 `UNAVAILABLE` 并说明来源侧原因。不得用展示 S/M/L、测量数据或 Agent/LLM 推断填入 `foreignSize`。

`sourceFacts.sizeEstimated` 是必填布尔值，表示 TRR 或来源是否依据测量估算了展示尺码。购买日期放入 `sourceFacts.order`：保留 `orderDateRaw`，并把 `orderedAt` 写成 `YYYY-MM-DD`、`YYYY-MM` 或 `YYYY`，再相应标为 `DAY`、`MONTH` 或 `YEAR`。该字段绝不写时分秒；日期无法取得时三个路径都逐项记录带原因的 `UNAVAILABLE`。

`order` 同时可以保留历史 TRR 的支付、调整、Store Credit、订单行、订单号、来源状态、退货规则及成本口径等原始事实。日期回填只新增或校验上述三个日期字段，不删除、改写或把这些既有来源事实解释成 ToMe 的库存、成本或交易事实。

上述字段都是来源事实，不在 `agentProposal.fields` 目录中。Agent 可以按目录整理本地审核用尺码，但不能建议、推断或写入品牌/标签原始尺码、估算标记、购买日期或日期精度。

### 薄 MCP

`/api/mcp/ingest` 是无状态、受 `X-Ingest-Token` 或同一 Token 的 `Authorization: Bearer` 保护的 JSON-RPC MCP 工具面。POST 接收单条请求或批次；仅通知时返回空的 HTTP 202，含请求时返回 HTTP 200 JSON。服务端校验浏览器 Origin，避免跨站页面携带 Token 调用。它不提供 SSE，已认证的 GET 明确返回 `405 Allow: POST`。只有以下六个工具：

- `tome_ingest_get_protocol`
- `tome_ingest_create_batch`
- `tome_ingest_import_order`
- `tome_ingest_upsert_candidates`
- `tome_ingest_get_batch_status`
- `tome_ingest_seal_batch`

MCP 直接复用 `IngestService` 与采购订单导入服务；不提供候选确认、TM、库存、成交、成本或发布工具。图片继续走现有 multipart HTTP 接口，不使用 Base64 MCP 上传。

### 确定性 CLI

发布包内提供 `tome-ingest`：

```sh
export TOME_INGEST_BASE_URL='https://example.invalid/api/agent-ingest'
export TOME_INGEST_TOKEN='本次短期令牌'
tome-ingest protocol
tome-ingest batch create batch.json
tome-ingest order import order.json
tome-ingest candidates upsert <batch-id> candidates.json
tome-ingest asset upload <candidate-id> image.jpg --source-url 'https://…'
tome-ingest batch status <batch-id>
tome-ingest batch seal <batch-id>
```

未以包安装时，也可在源码根目录执行 `npm run tome-ingest -- protocol`。CLI 每次写入前都会校验协议、Skill 和 Profile；当前目录的 `.tome-ingest-state.json` 只保存 operation fingerprint、幂等键、服务器 ID 和状态，绝不保存 Token、Cookie 或第三方凭据。结果未知时使用同一输入重新执行原命令，使其复用同一幂等键。
