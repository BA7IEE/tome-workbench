# 通用 Agent 导入协议

## 目的
ToMeBoutique 不内置网页采集机器人。Codex、WorkBuddy、自研脚本或其他桌面 Agent 都通过同一协议把外部来源事实提交到“待确认商品池”。

后台人员在「导入记录 → 外部工具接入」（旧待确认入口仍保留）创建短期导入会话。Token 只显示一次，不等于后台账号，也不继承管理员权限。

## 请求约定
Agent 请求使用：

- `X-Ingest-Token: <短期Token>`
- 所有写请求必须带 `Idempotency-Key`
- Base URL：`/api/agent-ingest`

网络回执中断时，必须使用**同一个 Idempotency-Key 和同一请求内容**重试；不要生成新请求号来猜测是否成功。

## 推荐流程
1. `POST /batches` 创建采集批次。
2. `POST /orders` 提交来源订单事实；没有订单的来源可跳过。
3. `POST /batches/:id/candidates` 批量提交商品候选。
4. `POST /candidates/:id/assets` 上传已下载的来源图片原件。
5. `POST /batches/:id/seal` 封闭批次。

封批后批次不可继续增加候选或图片；重新采集同一外部商品使用稳定 `externalKey`，系统追加修订而不是制造第二件候选。
## 候选商品必须提供的稳定信息
每个候选至少需要稳定 `externalKey` 和商品名称。建议同时提交：来源货号、品牌原文、品类路径、来源成色/状态、订单行金额、平台现价、估计零售价、尺码、颜色、材质、尺寸、描述、来源 URL、原始 JSON。

这些字段是**来源事实**。Agent 不应替经营中台决定：本地标准成色、本地库存状态、商品售价、人民币成本、图片公开授权或是否成交。

## 图片
图片以 multipart/form-data 上传。中台保存原文件并按 SHA 去重；确认 TM 时复用原文件，不要求 Agent 再下载一次。

Agent 导入图默认转为 TM 的 `REFERENCE / INTERNAL / 未核验` 素材。公开销售前是否可使用仍由人工核对授权。

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
          {"path": "sourceFacts.sizeLabel", "label": "标签尺码", "status": "UNAVAILABLE", "reason": "来源页面未提供"}
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
    "rawPayload": {"synthetic": true}
  }]
}
```

图片quality：ORIGINAL原图；LARGEST_AVAILABLE来源可取得最大图（说明依据）；THUMBNAIL仅缩略图；UNAVAILABLE未取得（后两者必须说明原因）。除UNAVAILABLE外须填写实际文件sha256、width、height。后端保留上传字节，并核对实际文件尺寸；不要放大缩略图冒充原图。每候选最多100个字段检查和100张图；来源有更多内容时应明确报告，不能悄悄截断。

`GET /batches/:id`新增integrity报告，包含预期/收到件数、逐件问题及封批阻断项。缺商品、文件或字段检查、标记已取但未传值、尺寸不符会使封批返回409。来源缺失或仅缩略图可封批但保持GAPS，需后台单件说明后确认；COMPLETE表示声明内检查完成，UNVERIFIED表示无有效清单，不能声称已收齐远端全部内容。原文件存储是保证上传字节不改，不是独立鉴定图片最高质量。

原文件入口：`GET /api/ingest/candidate-assets/:id/original`，普通登录的内部读权限；关联素材变为内部凭证后重查财务权限。机器Token不能用于后台文件读取或商品/库存/成本写操作。预览与原件均不公开缓存。

同externalBatchKey重新创建必须使用相同rawManifest；改变清单应新建批次。封批不能继续写，重新采集用新批次和稳定externalKey；已有候选更新来源修订而不新建TM。稀疏补充保留已有非空来源字段、递归参数和人工建议，capture整体替换以表达本次检查。已确认商品的新来源图停留在候选证据层，不自动修改Item素材或公开授权。历史来源原文保存在修订中；要纠正/撤回旧值须明确人工核对，不能用漏传字段实现删除。

后台批量接口仍每次最多100件，新增可选versions映射（候选ID到看到的版本）。新版界面跨页最多选1000件并自动分段。每段及重试使用固定幂等键、固定ID顺序与版本；部分失败有逐件原因。旧客户端未传versions保持兼容，新客户端必须传以保护人工看到的版本。

### 来源品相说明
`sourceFacts.conditionDescription`（或兼容的`conditionNotes`）用于单件品相/瑕疵原文，不应把平台的全部成色等级选项拼作单件说明。`conditionRaw`保存页面实际选中等级。确认新TM时将来源品牌、平台名和品相说明（最多1000字符的展示快照，完整原文仍在sourceFacts）保存在来源扩展资料；人工成色等级仍须单独确认。

多来源字段映射、原文、身份和成本政策的约定见[MULTI-SOURCE-DESIGN.md](MULTI-SOURCE-DESIGN.md)。来源ID隔离externalKey；新候选省略currency时采用来源默认币种，后续稀疏修订省略时保持已有币种。适配器应尽量显式传入实际原币，来源币种不推导人民币成本。


## 1.2 文件来源和批次历史（rc.15）

网页来源继续使用 capture.pageUrl。线下表格、网盘整理等没有商品网页时，可使用 capture.fileEvidence={name,sha256,row}，name 为原文件名、sha256 为64位十六进制校验值、row 为记录位置（表格行、文件内编号等）。图片记录可用 sourceFile 替代 sourceUrl；保留 sha256/width/height 等原有完整性字段及实际上传要求，不为通过校验伪造网址。fileEvidence 的文件摘要是提交的来源证据；只有实际上传的图片会进行服务端文件校验，未上传表格本体不宣称已独立核验。

普通后台 GET /api/ingest/batch-records?q=...&page=1 每页30批，返回来源、批次和当前决定计数。GET /api/ingest/candidates?batchId=... 按历史成员进入本批。第二批补采增加成员关系，旧批次不会消失；已封批的完整性核对使用封批时审计，候选详情展示最新来源修订。升级仅补已有候选当前可证明的成员关系，不恢复曾被覆盖的未知旧历史。

普通后台 bulk-confirm 可携带 incompleteAcknowledgements:{候选ID:核对依据}，每条依据不少于3字，并且必须属于本次 ids 和对应 versions。界面先集中展示合法 GAPS 再显式勾选和填写；缺少预期原文件、文件不符、身份疑问等阻断仍由共享确认规则拒绝。机器 token 无权确认。

批量可选择最多1000件，每100件提交，完成回执逐段保留。关闭后回到原浏览器、同一账号可以继续原请求，成功项不重复建档。服务器事实和错误结果与本地恢复进度分开；清理浏览器数据会失去待重试输入，应从批次实际结果重新核对。
