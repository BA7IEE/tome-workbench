# 当前发布事实

当前源码版本：**1.1.0-rc.7**，标准 Agent 采集、标准分发 Handoff Skill/薄 MCP、轻量分发记录与经营投影、来源关联停售、交易经营意图 `DistributionTarget`、发布安全复核、询盘日程、成交币种与外币结算安全阻断、动态 Readiness 与规模化运营工作流、Real Operations 与 AnQiCMS 本地标准交付合同；尚未完成真实生产和经营验收。

rc.7 新增正式生产部署模式 `EXTERNAL_REVERSE_PROXY`：同一生产 Compose 将两个 API 仅发布到宿主机 loopback，内置 Caddy 改为显式 `internal-proxy` profile；配置生成器记录部署模式和外部代理提供方，生产 preflight 对 1Panel/OpenResty 等外部入口验证 loopback 端口、禁止内置 proxy 常驻、正式域名 HTTPS readiness 与版本一致性。默认 `INTERNAL_CADDY` 行为仍保留；这不等于真实服务器、域名、防火墙、备份或业务 UAT 已经人工验收。

rc.4 最终已核验基线是 `main@522a49198aff933dd2deaae06460ec09486fa5f5`（`522a491`）；该提交的 [main push CI 35248179645](https://github.com/BA7IEE/tome-workbench/actions/runs/35248179645) 已完成且成功。这是历史核验记录，不是动态分支指针；后续源码必须以自身的验证摘要和对应 CI 为准。

rc.5 的已发布候选基线是 `main@cb1fe6ce0eb9a6a915a02107e10714c8fb5e0e06`（`cb1fe6c`），对应 main CI `35303053133` 成功。其后 PR #23 / #24 在不扩展平台执行边界的前提下补齐发布/停售代际屏障、UPDATE 远端身份一致性、历史在线 Exposure 的同平台多账号保护，以及 OTHER/历史 stop-only Profile；收口后的代码基线是 `main@7d381f9f25aed081f7be0e128894ad659d7034df`，main CI `35339741681` 成功。rc.6 只将这一收口状态形成新的可追溯候选，不代表真实平台 UAT 已完成。

功能基线：rc.15–19 与 UX 1.0.2。默认工作台，工作台 / 商品库 / 导入记录 / 商品分发 / 销售 / 更多六入口；商品分发按发布权限显示，销售按权限显示。商品先只读浏览、明确进入编辑。候选默认 PAUSED。UX 1.0.2 已合并，包含账号与浏览器范围的选品草稿恢复、发布图片排序、批量动作单次确认和按商品状态组织的主要动作；保留既有权限、领域写入和原图恢复规则。

本版保留 Agent Ingest Standard v1.2：`/api/agent-ingest` 仍是唯一机器写入合同，上层有 SHA-256 校验的 Skill、按来源代码选择的 Profile、六工具薄 MCP 与确定性 `tome-ingest` CLI。所有新机器 Batch 必须带 protocolVersion、Skill 与服务端 Profile；只对已存在、同键同清单的历史 Batch 保持旧合同兼容，不能以漏 metadata 绕过 Profile 必查项。标准 Profile 的服务端必查字段会与 Agent 自报字段合并；MCP 支持同一短期 Token 的 X 头或 Bearer 头，机器令牌仍无候选确认、TM、库存、成交、成本和发布权限。 新增 credential security closure：导入 Token 只在首次创建响应中出现，Receipt 永不保存明文；历史 create-session Receipt 通过 forward migration 永久移除 token。机器请求每次都会重新核验会话创建者仍为 active 且保有 supply 权限、来源仍启用，后台会话列表不返回 tokenHash。机器写入还会拒绝明显的密码、Cookie、Token、授权头和带访问签名的 URL，避免宽松 sourceFacts/rawPayload 变成凭据仓库。

本版将 Distribution Foundation 收敛为标准资料交付与轻量分发记录：已发布的 `DistributionSession`/`DistributionAttempt` 表及历史 migration 原样保留，但默认 UI 不再把它描述为平台执行 Runtime。`PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN/CANCELLED` 分别显示为待交付、已交付、已确认完成、需要处理、需要核对、已取消；`UNKNOWN` 只能在原记录填写依据后人工核对为成功或失败，并另记审计。系统比较冻结资料内容和历史记录，自动选择 PUBLISH、UPDATE 或 NOOP；未处理的交付会回到原记录，不能靠新 UsePackage 重复发布。标准 `tome-distribution/1.0` Skill 及 `/api/mcp/distribution` 只提供列出交付、取得冻结包、确认目标操作完成、报告待人工处理四项能力；取包才将记录记为“已交付”，并按 Channel、会话、当前创建者发布权限、图片权利和 UsePackage 重验。机器先从 protocol 读取并校验 Skill/Profile SHA-256，X 头与同一 Token 的 Bearer 等价；它不暴露领取、心跳、租约、浏览器步骤或任何平台动作。前向 migration `202609170015_distribution_source_attempt` 让 DELIST 用 `sourceAttemptId` 绑定具体成功资料代际；从 AVAILABLE 转为任何不可售状态时，每个已发布渠道都有一条去重的需要停售记录，恢复 AVAILABLE 不自动重新交付。只有取得稳定 `remoteId` 才创建 Listing；APP 渠道没有远端 ID 时按标题永久 TM 复核，禁止用 `MANUAL:TM...` 伪造身份；AnQiCMS 的 PUBLISH/UPDATE 成功则必须回传稳定 archive ID。受限 Token、领取和租约仍是兼容的高级接口，但默认 `DISTRIBUTION_COMPAT_RUNTIME_ENABLED=false`；没有真实第三方连接或外部副作用。

分发中心默认页是只读的激活 Target 加历史真实 Exposure 经营投影：从 Item、Readiness、冻结 UsePackage、DistributionAttempt 和已知 Listing 计算未发布（READY）、缺资料（BLOCKED）、待交付、已交付、已发布、待更新、异常和需停售，不新增 `ChannelInventoryTruth` 一类第二商品真相表。`GET /api/distribution/operations` 先按渠道、状态、品牌、TM/商品搜索过滤并排序，再分页；返回的汇总与页面卡片来自同一份投影。Dashboard 的“分发异常”只统计 `scope=attention`，点击也精确进入 `#/distribution?scope=attention`。该读取面没有平台 Connector、自动重发或任何自动平台停售动作。

本版新增 Real Operations：前向 migrations `202609170013_real_operations_price_basis` 与 `202609170014_channel_price_revision_continuity` 让草稿和冻结 UsePackage 绑定有效渠道价的来源/版本，并保留“改回默认价”后的版本连续性。`ChannelPrice` 存在且启用时覆盖 Item 默认报价，否则回退 `Item.currentPrice/currency`；Readiness、预览、草稿、UsePackage 和有效包复核都使用同一解析。AnQiCMS 必须是 USD、闲鱼必须是 CNY；没有自动换汇。询盘的 `WON` 只由确认成交动作产生：同一事务锁定 Item、检查版本与预留、创建 Sale、停售、更新 Inquiry、写 Audit/Outbox 并为已成功分发渠道计划 DELIST。商品库提供批量批准预检、批量渠道价和批量资料交付；分发中心只记录交付、回传和需要停售的经营状态，不调用第三方。

本版新增 AnQiCMS 本地标准资料交付合同：它将冻结使用包映射为 tm_code、USD、最多 9 张 Gallery 图片、正文图片、分开的 `condition_grade`/`condition_description`、统一的 `styleNumber` 与 SEO 资料，供外部 Agent 的 MCP/API 或人工取用；标准取包以 `platformData` 包装同一 builder 输出。没有 archive ID 时只允许执行方按 tm_code 保护性查找，AnQiCMS 的 PUBLISH/UPDATE 不能确认成功；取得稳定 archive ID 后才可回填 Listing。售出后的 DELIST 是只读取 TM、当前状态和 archive ID 的 identity-only 投影，要求 stock=0、保留页面、SOLD、无 Checkout，不被历史图片授权或使用包失效阻塞。标准 Handoff 超过可配置时限或会话失效时只在经营投影显示 ATTENTION，不自动重发或改写原记录。保留的受限读取接口没有 HTTP 客户端、配置或凭据读取、外部请求或数据库写入；真实 API/UAT 在 ToMe 外部完成，20 件真实授权商品 UAT 本次未做。

当前源码新增 `Channel.businessPurpose` 与 `DistributionTarget`。`TRADE` 是唯一可以设为交易经营目标、写 ChannelPrice 或走 TRADE Readiness/资料交付的用途；XHS 固定为 `CONTENT`，SHOWROOM 固定为 `SHOWROOM`。Target 仅记录“当前希望在哪个交易账号经营此 TM”，每个 Item×Channel 唯一、可关闭、同平台多账号激活须明确确认；它在 Item lock、Receipt、Audit 与 Outbox 同一事务中写入，不创建 UsePackage、DistributionAttempt、Listing 或外部平台动作。

当前源码还新增 `PublicationHealthService`。它以成功 PUBLISH/UPDATE 为远端暴露事实，不要求 APP 有 stable `remoteId` 或 Listing；库存不可售、关闭 Target、停用/退出 TRADE 的 Channel、失效 Offer、批准/鉴定、发布图片权利以及缺失、非正数或错币种的交易价都会显示为需停售，并由 Worker/Sweep 仅计划来源关联 DELIST。批准版本、渠道报价、文案或图片变化显示为待更新。UsePackage 的七天 TTL 仍拦住新交付，却不会单独改变已确认发布的状态。停用渠道会在本地取消未交付的 PUBLISH/UPDATE，且仅在仍有 DELIST 时允许 stop-only 会话；回收站同样阻止已交付、未知、成功或未完成停售的远端暴露。该发布安全切片不产生第三方动作或自动重发。

渠道币种与成交补充：`Channel.defaultCurrency` 是账号默认币种；AnQiCMS 固定 USD、闲鱼固定 CNY，后端拒绝错误账号配置和错误 ChannelPrice。选择不同目标币种的账号时，批量和单件渠道价不复制 Item 金额，必须显式填写；询盘默认带同币种有效渠道价，缺价时只保留目标币种与 NULL。前向 migration `202609180017_inquiry_followup` 新增 `Inquiry.nextFollowUpAt` 与索引：FOLLOWUP 必须给出下次跟进时间，OPEN/WON/LOST 不保留日程；工作队列把逾期 FOLLOWUP 提升为 90、今天 FOLLOWUP/新 OPEN 为 85、未来 FOLLOWUP 为 55。询盘转 Sale 严格保留 `Inquiry.currency`；配置账号直接成交以有效渠道价币种或账号要求币种为准，未配置账号使用 Item 币种。只有 CNY Sale 自动冻结 CNY 成本，外币 Sale 的成本保持 NULL。没有 FX basis 的外币结算确认返回 `FOREIGN_SETTLEMENT_FX_BASIS_REQUIRED`，没有实时汇率、自动定价或 FX 引擎，也不改写已有外币 Sale。

运营规模化收口：渠道 Readiness 只在激活的 `DistributionTarget` 与历史真实 Exposure 配对上动态计算，Readiness 缺项不再创建持久 `PREPARE` Task；历史 Task 不被改写。 主工作队列现在与分发经营投影保持一致：已交付超过时限或其分发会话失效的记录也进入 DISTRIBUTION 待办；外币 Sale 的空成本不再被描述为缺人民币成本，而明确显示为待确认外币结算依据。分发读取面先限定这些配对，再批量加载健康判断所需事实，避免 Item × Channel 笛卡尔积和按行 N+1。未批准的正式 TM 进入全局工作队列而非当前页切片；成本批量操作以最多 100 单的一次 `previews` 请求复用既有成本计算。Quick Intake 只建立 `ownership=OWN` 的我方现货，来源/供应商货仍走来源与人工确认。列表中的“发布记录”统一称为“远端身份记录”。隔离的 1,000 Item / 8 Channel 基准验证 Operations、Dashboard 与工作队列均在 1 秒内完成。

## 自动维护约束

以下清单由实际源码目录生成，`node scripts/check-current-docs.mjs` 核对版本、迁移、双浏览器文件范围，以及当前版本 validation 摘要的版本和源码指纹。目录新增文件时必须更新清单，不能只手填通过数。

<!-- current-facts -->

```json
{
  "version": "1.1.0-rc.7",
  "migrations": [
    "202609100001_initial",
    "202609100002_workflow_reliability",
    "202609100003_statement_guards",
    "202609110004_channel_workspaces",
    "202609110005_item_recycle_bin",
    "202609110006_dictionary_catalog",
    "202609120007_test_data_scope",
    "202609120008_procurement_records",
    "202609130009_item_centric_v1",
    "202609140001_operating_record_versions",
    "202609150011_product_materials",
    "202609170012_distribution_foundation",
    "202609170013_real_operations_price_basis",
    "202609170014_channel_price_revision_continuity",
    "202609170015_distribution_source_attempt",
    "202609180016_distribution_intent",
    "202609180017_inquiry_followup",
    "202609180018_ingest_credential_redaction"
  ],
  "browserFiles": [
    "arco-workspace.spec.cjs",
    "dictionaries.spec.cjs",
    "interaction.spec.cjs",
    "operations.spec.cjs",
    "procurement.spec.cjs",
    "product-library.spec.cjs",
    "studio.spec.cjs",
    "system-review.spec.cjs",
    "ui08.spec.cjs",
    "ux09-audit.spec.cjs",
    "ux09.spec.cjs",
    "ux10.spec.cjs",
    "ux101.spec.cjs",
    "ux2.spec.cjs",
    "v1-item-center.spec.cjs",
    "workbench.spec.cjs"
  ]
}
```

## 验证入口

`node scripts/prepare-test.mjs` 后运行 `npm run verify:release`，覆盖语法、类型、lint、构建、单测、真实隔离 PG 集成、Chromium、WebKit、HA、恢复、Harness；随后 npm audit 和 npm run pack。两个浏览器范围相同，retries/skipped/flaky 均为零。源码指纹必须与验证一致。

实际结果见 [VALIDATION](VALIDATION.md)。旧报告不能证明新源码已验证。所有历史 migration 和封印保持不变。

## 已核验基线

- rc.4 的 main 基线与成功 CI 见上方固定记录；它只证明当时的源码，不代替 rc.5 的当前验证。
- 本版的完整门禁、审计和打包证据以 [VALIDATION](VALIDATION.md) 与对应版本目录为准；生产、真实平台和经营 UAT 仍由独立授权验收。

## 本版范围

- 标准 Agent Ingest 只扩展候选采集入口和运营侧接入说明；Distribution Foundation、Real Operations、经营投影与 AnQiCMS 本地标准交付合同建立标准资料交付、轻量经营状态、渠道报价、询盘成交转化、下次跟进日程、成交币种真相、批量预检、来源关联的下架计划和可验证的站点资料映射。动态 Readiness、全局未批准商品待办、批量成本预览和规模基准只复用既有事实与命令。既有 Item、Sale、成本、库存、UsePackage、图片权利、审计和历史 migration 封印保持不动。
- ChannelPrice 不自动换汇或覆盖 Item 默认报价；批量动作逐件复用原批准、使用包和分发命令，不用批量数据库写绕过 item lock、版本、Audit 或 Receipt。APP 无稳定 ID 的已发布商品售出后仍以永久 TM 计划下架，不能因为没有 Listing 漏掉。
- `DistributionTarget` 只增加当前交易经营意图，不能把内容/展厅渠道变成交易渠道，也不能替代真实发布、远端身份、库存或停售回执。 新的 TRADE PUBLISH/UPDATE 与稳定 Listing 回执必须先有 active Target；旧历史 Exposure 保持可见和可停售，但不能在缺少当前经营意图时继续生成新的发布事实。
- 发布安全只维护本地经营状态和来源关联 DELIST：不把 UsePackage TTL 当远端页面寿命，不删除仍可能在线的商品，也不调用平台下架、重发或浏览器自动化。

## 尚未完成

- 实际异地备份、正式独立恢复、告警收件人测试、域名防火墙核验和真实经营 UAT 尚未验收。
- ToMe 不实现 AnQiCMS 或其他平台的真实 Connector、登录、验证码、页面自动化或发布动作；外部 Agent 的 MCP/API、archive ID 实测回传、真实账号操作、支付/订单和真实经营验收仍需各自单独完成。本轮未部署、未连接真实经营数据库或第三方，外部副作用保持 OFF。代码合并和 CI 成功不代表实际生产或经营验收完成。

长期蓝图与实现差距见 [AC_MATRIX](AC_MATRIX.md)；历史阶段见 [archive](archive/README.md)，不是当前执行指令。
