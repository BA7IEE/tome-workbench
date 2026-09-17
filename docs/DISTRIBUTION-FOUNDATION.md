# 标准资料交付与 Real Operations · 1.1.0-rc.4

ToMeBoutique 只准备标准资料、冻结 UsePackage、维护渠道报价并记录交付后的经营状态。闲鱼、Vestiaire、Grailed、Carousell、AnQiCMS 等平台的点击、浏览器或 APP 自动化、登录、验证码、页面步骤都由外部 Agent、脚本或人工完成；ToMe 不连接平台，也不会从系统内发起这些动作。

## 事实边界

`Item` 仍是唯一商品与库存事实。来源、采购与 Agent 都只是证据；`UsePackage` 是已通过图片权利和资料检查的冻结对外资料。已发布的 `DistributionSession` 与 `DistributionAttempt` 表、历史 migration 和兼容接口保持不动，但默认产品语义把 Attempt 称为“分发记录”，不是平台执行 Runtime。

`Listing` 只表示已知的稳定 `remoteId`。APP 渠道没有稳定 ID 时仍可确认资料已经交付完成，并按标题中的永久 TM 后续核对；严禁用 `MANUAL:TM...` 等伪 ID 补齐。

`Channel.defaultCurrency` 是账号维度的默认币种：AnQiCMS 固定 USD、闲鱼固定 CNY、其他渠道使用账号设置；创建、编辑和写入渠道价时后端都会拒绝违反固定平台约束的值。`ChannelPrice` 是账号维度的明确报价。启用的覆盖值优先于 `Item.currentPrice/currency`，未启用时才回退默认报价；当回退价币种不同于目标账号时，它不能作为可发布价或被复制成目标金额。不会实时换汇或改写 Item。Readiness、预览、PublishingDraft、UsePackage 创建和有效包校验使用同一有效价，因此改价、改回默认价或恢复覆盖都会让旧资料重新核验。询盘选择配置账号时，默认采用同币种有效渠道价；不具备该价格时只带目标币种并保留未知金额。

## 默认交付路径

1. 用已批准资料生成 UsePackage。
2. 系统比较冻结资料内容、该渠道已确认完成的资料和已确认停售事实，自动决定 `PUBLISH`、`UPDATE` 或 `NOOP`。待交付、已交付或需要核对的原记录尚未处理时，只返回原记录，不能靠重新生成 UsePackage 重复发布。
3. 把冻结资料交给外部 Agent、脚本或人工，在目标平台完成实际操作。
4. 回填分发记录。稳定 ID 已知时才创建或更新 Listing；没有稳定 ID 时留下可按永久 TM 核对的依据。
5. 成功资料未变化时得到 NOOP，不会创建新的平台发布或新的分发记录。

## 标准 Handoff 面

仓库内的 `agent/skills/tome-distribution` 和[标准分发交付合同](DISTRIBUTION-HANDOFF-CONTRACT.md)是默认机器接入面。`GET /api/distribution-agent/handoffs` 只列当前 Channel 待交付资料和本会话已交付资料；带幂等键的 `POST .../package` 才把记录记为已交付，并且只返回有效 UsePackage 的冻结字段和按位置排序的图片。每次机器写入及每个 Receipt 重放都会重查 Channel 会话、创建者的当前 publish 权限、Item lock、包版本和图片权利。

薄 MCP `/api/mcp/distribution` 只有 `tome_distribution_list_handoffs`、`tome_distribution_get_package`、`tome_distribution_report_published`、`tome_distribution_report_attention`。完成回传的 remoteId 可为空，AnQiCMS 真实 archive ID 应原样保存；伪造 `MANUAL:TM...` 一律拒绝。`ATTENTION` 把原记录转为 UNKNOWN，之后只能人工核对。DELIST 没有有效发布包时只交付永久 TM 和 Channel 身份，不能让历史图片权利成为停售阻断。

分发中心把内部状态显示为：PENDING=待交付、RUNNING=已交付、SUCCEEDED=已确认完成、FAILED=需要处理、UNKNOWN=需要核对、CANCELLED=已取消。它还汇总尚未确认完成的停售记录；页面不会保存凭据或调用第三方。

## UNKNOWN 人工核对

UNKNOWN 不能直接重试，也不能新建第二条发布资料。操作者必须在原渠道按永久 TM 核对，并在**原分发记录**填写核对依据后，把它改为已确认完成或需要处理。每次这种人工核对都单独写 Audit；确认成功会清除过期的失败/未知错误文本。FAILED 仍可复用原记录重新交付，不创建第二个执行事实。

“登记 Listing 回执”也遵循同一套 PUBLISH/UPDATE/NOOP 决策：它不能用一个新的 UsePackage 绕过待处理的原交付，也不能伪造 APP 远端身份。

## 兼容的高级接口

短期 `DistributionSession`、Token 哈希、渠道隔离、领取与租约仍为未来扩展保留。Token 只在创建响应出现一次，数据库、Audit 和 Receipt 都不保存明文；该接口不能创建/修改 TM、Sale、库存、成本、价格、渠道配置或 Candidate，也不授予平台登录能力。

它不是默认工作流，也不意味着 ToMe 会执行任何外部平台动作。需要此类能力的外部 Agent 仍应只读取已授权的冻结资料并回传结果。

## 运营闭环

`planStopDistribution` 在既有 Item 锁和同一事务中处理所有 `AVAILABLE → RESERVED/PAUSED/SOLD/GIFTED/SELF_USE/SUPPLIER_SOLD/QUARANTINED`。它逐渠道找到当前周期最近一条成功的 PUBLISH/UPDATE，并新建“需要停售”的 DELIST 记录；`sourceAttemptId` 指向该次成功资料，去重键是 `delist:<sourcePublishAttemptId>`。因此第一次发布 A 的停售不会挡住以后重新交付 B 的停售。APP 没有 Listing 也不例外：外部操作者用永久 TM 定位。

`202609170015_distribution_source_attempt` 是仅新增的前向 migration。历史 DELIST 不被重写；若已有与历史成功资料时间相符的无关联停售事实，它仍是权威记录，不会被重复补发。若商品已经不可售、一个仍在交付的 PUBLISH/UPDATE 之后才确认成功，回执事务也会补建同一来源关联的停售记录。

恢复 `AVAILABLE` 只恢复库存状态、Audit 和 Outbox，绝不自动 PUBLISH/UPDATE；运营人员必须重新检查资料后明确交付。商品库的批量确认资料先预检，再逐件调用已有 approve 命令；批量渠道价与批量资料交付也逐件调用已有写入命令。

## 明确未做

- 真实平台 Connector、自动登录 APP、验证码、点击/页面自动化、凭据托管；
- 实时汇率、自动价格引擎、自动重新发布；
- AnQiCMS 真实 API 调用和真实 archive ID UAT。ToMe 只提供本地资料合同；外部 Agent 的 MCP/API 回传稳定 archive ID 后才可登记。

自动化只使用隔离 `tome_test` 与合成资料。真实账号、凭据、会话、个人资料和经营数据不得进入源码、测试、日志、配置样例或交付包。
