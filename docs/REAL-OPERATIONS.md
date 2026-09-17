# Real Operations · 1.1.0-rc.5

本切片把“已有商品如何按渠道准备、确认成交后如何停止对外分发”落到本地经营事实中；不接通真实第三方，不把分发 Attempt 当成平台调用，也不改变 TM、来源证据、库存锁、成本、图片权利和现有审计边界。

## 渠道报价与资料冻结

`Channel.defaultCurrency` 是账号默认币种：AnQiCMS 固定 USD、闲鱼固定 CNY、其他平台使用账号设置。创建/编辑账号和写入 ChannelPrice 都由后端复核该约束，不能只靠界面。`resolveChannelPrice(item, channel)` 只做两级选择：启用的 `ChannelPrice` 优先，否则使用 `Item.currentPrice/currency`。目标账号与商品默认币种不同，就不把金额复制到目标币种；Readiness 会要求明确填写渠道价。渠道报价不会自动换汇，也不会反写 Item。

Readiness、预览、PublishingDraft、UsePackage 创建和有效包校验共享这一个解析。批量价选择渠道时同步切换目标币种和金额模板；只有同币种才带入 Item 价格，未知价格保持空白而不是 0。新草稿和使用包保存价格、币种以及来源/版本；因此同金额的渠道价被清除、后来又恢复时，旧包仍会失效，不能误把一次旧审核当成当前报价。未设置渠道价的历史包继续按 Item 回退价解释。

## 询盘成交

选择配置账号创建询盘时，若存在同币种有效 ChannelPrice，默认填写该金额和币种；否则报价保持 NULL，但币种使用该账号目标币种。显式输入仍由操作者负责，系统不臆造跨币种金额。前向 migration `202609180017_inquiry_followup` 为 Inquiry 增加 `nextFollowUpAt`：OPEN 可为空，FOLLOWUP 必须明确下次跟进时间，WON/LOST 一律清空。`POST /api/inquiries/:id/convert` 在一次事务中完成：锁定 Item、核对询盘版本与预留、拒绝重复 Sale、创建 `Sale(inquiryId, channelId, channel)`、停止销售、消费匹配预留、将 Inquiry 标为 WON，并写入 Audit/Outbox。

这一步优先保证实物停售；成交金额、成本、费用和到账状态仍可为 NULL，交给既有财务命令补录。成交币种不再从 Item 猜测：询盘转成交保留 `Inquiry.currency`；配置账号的直接成交取有效渠道价币种，若 Item 回退价不符合账号固定/默认币种则取该账号要求币种；未配置账号才取 `Item.currency`。只有 CNY Sale 自动冻结已确认 CNY 成本，外币 Sale 的 `cost` 保持 NULL，不能把人民币成本写入外币记录。已转化询盘不能再走普通状态接口改写。外币结算可生成本地预览，但没有经确认 FX basis 时确认返回 `FOREIGN_SETTLEMENT_FX_BASIS_REQUIRED`；本版没有 FX 引擎、自动换汇或实际结算动作。

## 分发和待办

`planStopDistribution` 在原库存命令的 Item 锁事务中处理 `AVAILABLE → RESERVED/PAUSED/SOLD/GIFTED/SELF_USE/SUPPLIER_SOLD/QUARANTINED`。它按 `Item + Channel + cycle` 找每个渠道最近成功的 PUBLISH/UPDATE，并创建 `delist:<sourceAttemptId>`；新 DELIST 的 `sourceAttemptId` 直接指向那条成功资料，所以发布 A 的停售不会挡住重新发布 B 后的停售。历史无关联 DELIST 不修改，仍按原时间事实防重。若旧的高级领取接口在停售前已领取、成功结果在停售后才回传，回执落库时也会补建同一来源关联记录。它不要求 Listing：APP 无稳定 remoteId 时，外部操作者用标题中的永久 TM 在指定账号内定位。DELIST、UNKNOWN 和 FAILED 都继续保留在原记录上，避免盲目重新发布；恢复 AVAILABLE 也不会自动重新交付。

`PublicationHealthService` 同样把无稳定 remoteId 的成功 PUBLISH/UPDATE 当作可能在线的远端暴露。库存、关闭 Target、停用/退出交易用途的 Channel、失效 Offer、批准/鉴定、发布图片权利和交易价不安全时，Worker/Sweep 只计划该成功资料的来源关联 DELIST；不会调用外部平台。安全但批准版本、渠道价、文案或图片变化时标为待更新。UsePackage 的七天 TTL 仍拦住新的交付，但不单独让成功发布待更新；回收站先本地取消未交付 PENDING，仍可能在线或未完成停售的记录一律阻止删除。

工作待办按经营风险排序：待停售 100、需要核对 95、库存冲突 90，逾期或遗漏下次时间的 FOLLOWUP 询盘同为 90；按上海自然日，今天 FOLLOWUP 与新 OPEN 为 85，未来 FOLLOWUP 为 55，需要处理的分发记录 70、资料缺项 50、成交补账 30。分发中心以同一份只读 Item × Channel 投影显示未发布、缺资料、待交付、已交付、已发布、待更新、异常和需停售；渠道、状态、品牌、TM/商品筛选先在服务端完成，再分页。Dashboard 的“分发异常”固定进入 `scope=attention`，统计与列表不分叉。投影不保存第二套渠道库存事实、凭据，也不发起第三方请求。

标准 Handoff 读取 DELIST 时可只得到永久 TM 和 Channel 身份；这是刻意保留的 identity-only 停售交付，外部执行方不能把它当成重新发布包。AnQiCMS 的售出投影进一步只读取 TM、当前状态和 Listing.archive ID，固定输出 stock=0、保页、SOLD、无 Checkout，不重验历史图片、价格、文案或使用包。它仍通过同一受限 Channel 会话回填确认完成或待人工核对；详情见 [DISTRIBUTION-HANDOFF-CONTRACT](DISTRIBUTION-HANDOFF-CONTRACT.md)。

## 批量操作与未做范围

批量批准先做只读预检，再逐件复用已有批准命令；批量渠道价和批量计划也逐件走既有幂等写入。任何一件因版本、图片、权限、库存或价格变化失败，都保留逐件结果，不用 `updateMany` 掩盖领域规则。

尚未实现真实平台连接器、AnQiCMS 真实 archive ID/UAT、支付/订单、自动调用第三方发布或下架、自动汇率。后续 AnQiCMS Connector 的本地标准字段合同已冻结在 [ANQICMS-CONTRACT](integrations/ANQICMS-CONTRACT.md)，包括 `styleNumber`、分开的成色等级/说明和 identity-only 售出投影，但不会发送请求。全部自动化只使用隔离 `tome_test` 和合成资料。
