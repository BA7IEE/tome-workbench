# Real Operations · 1.1.0-rc.3

本切片把“已有商品如何按渠道准备、确认成交后如何停止对外分发”落到本地经营事实中；不接通真实第三方，不把分发 Attempt 当成平台调用，也不改变 TM、来源证据、库存锁、成本、图片权利和现有审计边界。

## 渠道报价与资料冻结

`resolveChannelPrice(item, channel)` 只做两级选择：启用的 `ChannelPrice` 优先，否则使用 `Item.currentPrice/currency`。渠道报价不会自动换汇，也不会反写 Item；AnQiCMS 交易资料必须使用 USD，闲鱼必须使用 CNY。

Readiness、预览、PublishingDraft、UsePackage 创建和有效包校验共享这一个解析。新草稿和使用包保存价格、币种以及来源/版本；因此同金额的渠道价被清除、后来又恢复时，旧包仍会失效，不能误把一次旧审核当成当前报价。未设置渠道价的历史包继续按 Item 回退价解释。

## 询盘成交

普通询盘只可更新为 OPEN、FOLLOWUP 或 LOST。`POST /api/inquiries/:id/convert` 在一次事务中完成：锁定 Item、核对询盘版本与预留、拒绝重复 Sale、创建 `Sale(inquiryId, channelId, channel)`、停止销售、消费匹配预留、将 Inquiry 标为 WON，并写入 Audit/Outbox。

这一步优先保证实物停售；成交金额、成本、费用和到账状态仍可为 NULL，交给既有财务命令补录。已转化询盘不能再走普通状态接口改写。

## 分发和待办

`planStopDistribution` 在原库存命令的 Item 锁事务中处理 `AVAILABLE → RESERVED/PAUSED/SOLD/GIFTED/SELF_USE/SUPPLIER_SOLD/QUARANTINED`。它按 `Item + Channel + cycle` 找每个渠道最近成功的 PUBLISH/UPDATE，并创建 `delist:<sourceAttemptId>`；新 DELIST 的 `sourceAttemptId` 直接指向那条成功资料，所以发布 A 的停售不会挡住重新发布 B 后的停售。历史无关联 DELIST 不修改，仍按原时间事实防重。若旧的高级领取接口在停售前已领取、成功结果在停售后才回传，回执落库时也会补建同一来源关联记录。它不要求 Listing：APP 无稳定 remoteId 时，外部操作者用标题中的永久 TM 在指定账号内定位。DELIST、UNKNOWN 和 FAILED 都继续保留在原记录上，避免盲目重新发布；恢复 AVAILABLE 也不会自动重新交付。

工作待办按经营风险排序：待停售 100、需要核对 95、库存冲突 90、询盘 85、需要处理的分发记录 70、资料缺项 50、成交补账 30。分发中心只显示渠道统计和交付/经营记录；它不会保存凭据或发起第三方请求。

## 批量操作与未做范围

批量批准先做只读预检，再逐件复用已有批准命令；批量渠道价和批量计划也逐件走既有幂等写入。任何一件因版本、图片、权限、库存或价格变化失败，都保留逐件结果，不用 `updateMany` 掩盖领域规则。

尚未实现真实平台连接器、AnQiCMS 真实 archive ID/UAT、支付/订单、自动调用第三方发布或下架、自动汇率。后续 AnQiCMS Connector 的本地字段合同已冻结在 [ANQICMS-CONTRACT](integrations/ANQICMS-CONTRACT.md)，但不会发送请求。全部自动化只使用隔离 `tome_test` 和合成资料。
