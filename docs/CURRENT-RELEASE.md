# 当前发布事实

当前源码版本：**1.1.0-rc.4**，标准 Agent 采集、标准分发 Handoff Skill/薄 MCP、轻量分发记录、来源关联停售、Real Operations 与 AnQiCMS 本地 Spike 合同，尚未完成真实生产和经营验收。

2026-09-16 核验：PR #2、#3、#4 已依次合并到 main，合并后的提交为 `0be151ce47ca5eed282bbb1f5ce4c75276c4cc83`（`0be151c`）。该提交的 [main push CI 35079989770](https://github.com/BA7IEE/tome-workbench/actions/runs/35079989770) 已成功。这是已核验的提交与运行记录，不是动态分支指针；后续提交的验证以对应 CI 为准。

功能基线：rc.15–19 与 UX 1.0.2。默认工作台，工作台 / 商品库 / 导入记录 / 销售 / 设置五入口；销售按权限显示。商品先只读浏览、明确进入编辑。候选默认 PAUSED。UX 1.0.2 已合并，包含账号与浏览器范围的选品草稿恢复、发布图片排序、批量动作单次确认和按商品状态组织的主要动作；保留既有权限、领域写入和原图恢复规则。

本版保留 Agent Ingest Standard v1.2：`/api/agent-ingest` 仍是唯一机器写入合同，上层有 SHA-256 校验的 Skill、按来源代码选择的 Profile、六工具薄 MCP 与确定性 `tome-ingest` CLI。所有新机器 Batch 必须带 protocolVersion、Skill 与服务端 Profile；只对已存在、同键同清单的历史 Batch 保持旧合同兼容，不能以漏 metadata 绕过 Profile 必查项。标准 Profile 的服务端必查字段会与 Agent 自报字段合并；MCP 支持同一短期 Token 的 X 头或 Bearer 头，机器令牌仍无候选确认、TM、库存、成交、成本和发布权限。

本版将 Distribution Foundation 收敛为标准资料交付与轻量分发记录：已发布的 `DistributionSession`/`DistributionAttempt` 表及历史 migration 原样保留，但默认 UI 不再把它描述为平台执行 Runtime。`PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN/CANCELLED` 分别显示为待交付、已交付、已确认完成、需要处理、需要核对、已取消；`UNKNOWN` 只能在原记录填写依据后人工核对为成功或失败，并另记审计。系统比较冻结资料内容和历史记录，自动选择 PUBLISH、UPDATE 或 NOOP；未处理的交付会回到原记录，不能靠新 UsePackage 重复发布。标准 `tome-distribution/1.0` Skill 及 `/api/mcp/distribution` 只提供列出交付、取得冻结包、确认目标操作完成、报告待人工处理四项能力；取包才将记录记为“已交付”，并按 Channel、会话、当前创建者发布权限、图片权利和 UsePackage 重验。它不暴露领取、心跳、租约、浏览器步骤或任何平台动作。前向 migration `202609170015_distribution_source_attempt` 让 DELIST 用 `sourceAttemptId` 绑定具体成功资料代际；从 AVAILABLE 转为任何不可售状态时，每个已发布渠道都有一条去重的需要停售记录，恢复 AVAILABLE 不自动重新交付。只有取得稳定 `remoteId` 才创建 Listing；APP 渠道没有远端 ID 时按标题永久 TM 复核，禁止用 `MANUAL:TM...` 伪造身份。受限 Token、领取和租约仍是兼容的高级接口，默认操作路径不依赖它们；没有真实第三方连接或外部副作用。

本版新增 Real Operations：前向 migrations `202609170013_real_operations_price_basis` 与 `202609170014_channel_price_revision_continuity` 让草稿和冻结 UsePackage 绑定有效渠道价的来源/版本，并保留“改回默认价”后的版本连续性。`ChannelPrice` 存在且启用时覆盖 Item 默认报价，否则回退 `Item.currentPrice/currency`；Readiness、预览、草稿、UsePackage 和有效包复核都使用同一解析。AnQiCMS 必须是 USD、闲鱼必须是 CNY；没有自动换汇。询盘的 `WON` 只由确认成交动作产生：同一事务锁定 Item、检查版本与预留、创建 Sale、停售、更新 Inquiry、写 Audit/Outbox 并为已成功分发渠道计划 DELIST。商品库提供批量批准预检、批量渠道价和批量资料交付；分发中心只记录交付、回传和需要停售的经营状态，不调用第三方。

本版新增 AnQiCMS 本地资料交付合同：它将冻结使用包映射为 tm_code、USD、最多 9 张 Gallery 图片、正文图片、自定义字段与 SEO 资料，供外部 Agent 的 MCP/API 或人工取用。没有 archive ID 时只允许执行方按 tm_code 保护性查找，取得稳定 archive ID 后才可回填 Listing；售出后的 DELIST 合同要求 stock=0、保留页面、SOLD、无 Checkout。保留的受限读取接口没有 HTTP 客户端、配置或凭据读取、外部请求或数据库写入；真实 API/UAT 在 ToMe 外部完成。

渠道币种交互补充：`Channel.defaultCurrency` 是账号默认币种；AnQiCMS 固定 USD、闲鱼固定 CNY，后端拒绝错误账号配置和错误 ChannelPrice。选择不同目标币种的账号时，批量和单件渠道价不复制 Item 金额，必须显式填写；询盘默认带同币种有效渠道价，缺价时只保留目标币种与 NULL。没有实时汇率、自动定价或 Sale 财务模型重写。

## 自动维护约束

以下清单由实际源码目录生成，`node scripts/check-current-docs.mjs` 核对版本、迁移和双浏览器文件范围。目录新增文件时必须更新清单，不能只手填通过数。

<!-- current-facts -->
```json
{
  "version": "1.1.0-rc.4",
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
    "202609170015_distribution_source_attempt"
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

## 已合并的改动

- PR #2 修复原生 autofocus 延迟抢焦点造成的登录问题，以及图片保存完成前提前显示成功的问题。
- PR #3 实现版本统一、当前文档守卫、图片补偿、后端权限能力、生产备份恢复与 PushPlus 显式启用工具。
- PR #4 实现上述 UX 1.0.2 功能。三项 PR 的最终 CI 均通过；本地完整门禁和打包证据见 [VALIDATION](VALIDATION.md)，合并后的 CI 见上方运行记录。

## 本版范围

- 标准 Agent Ingest 只扩展候选采集入口和运营侧接入说明；Distribution Foundation、Real Operations 与 AnQiCMS 本地 Spike 合同建立标准资料交付、轻量经营状态、渠道报价、询盘成交转化、批量预检、来源关联的下架计划和可验证的站点资料映射。既有 Item、Sale、成本、库存、UsePackage、图片权利、审计和历史 migration 封印保持不动。
- ChannelPrice 不自动换汇或覆盖 Item 默认报价；批量动作逐件复用原批准、使用包和分发命令，不用批量数据库写绕过 item lock、版本、Audit 或 Receipt。APP 无稳定 ID 的已发布商品售出后仍以永久 TM 计划下架，不能因为没有 Listing 漏掉。

## 尚未完成

- 实际异地备份、正式独立恢复、告警收件人测试、域名防火墙核验和真实经营 UAT 尚未验收。
- ToMe 不实现 AnQiCMS 或其他平台的真实 Connector、登录、验证码、页面自动化或发布动作；外部 Agent 的 MCP/API、archive ID 实测回传、真实账号操作、支付/订单和真实经营验收仍需各自单独完成。本轮未部署、未连接真实经营数据库或第三方，外部副作用保持 OFF。代码合并和 CI 成功不代表实际生产或经营验收完成。

长期蓝图与实现差距见 [AC_MATRIX](AC_MATRIX.md)；历史阶段见 [archive](archive/README.md)，不是当前执行指令。
