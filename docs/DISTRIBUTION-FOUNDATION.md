# Distribution Foundation · 1.1.0-rc.2

这是“标准 Agent 采集 + 批量商品分发”中的第二个独立切片。它只建立分发执行事实和受限执行面；不连接任何真实第三方，不自动发布、改价、下架或改变库存。

## 事实边界

`Item` 仍是唯一商品与库存事实。`UsePackage` 是冻结的、已经过图片权利和资料校验的对外资料。`DistributionAttempt` 记录“某个包针对某个渠道的一次发布、更新、核对或下架执行”，而非商品事实本身。

只有回传稳定 `remoteId` 时才建立或更新 `Listing`。APP/UI 渠道拿不到稳定 ID 的成功结果合法，系统保存成功 Attempt，并以标题中的永久 TM 为后续核对和下架 locator。严禁使用 `MANUAL:TM...` 等伪远端 ID。

`ChannelPrice` 已作为独立渠道报价事实新增；当前切片只保存其结构，尚未把它接入 Readiness、Package 或 PublishingService。现有 `Item.currentPrice/currency` 的回退逻辑不变，effective channel price 属于 Real Operations 切片，不能提前把表存在当作报价已生效。

## 受限 Agent 面

后台有 `users` 权限的账号创建短期 `DistributionSession`，一次性 Token 只在创建响应出现。数据库、Audit 和 Receipt 都不保存该 Token 明文，只保存 SHA-256 哈希和“已签发”事实。

受限 Agent 只能带 `X-Distribution-Token` 调用 `/api/distribution-agent`：

- 查看协议和自己渠道的可领取 Attempt；
- 领取一条 Attempt 的短租约；
- 在租约有效时读取该 Attempt 当前 UsePackage，以及包内允许分发的原图；
- 回传 `SUCCEEDED`、`FAILED` 或 `UNKNOWN` 结果。

它不能调用正常后台写接口，不能创建/修改 TM、Sale、库存、成本、价格、渠道配置或 Candidate 确认；也不能读取其他渠道、非当前 Attempt 或已失效包的图片。

`UNKNOWN` 不能直接重试或新建发布 Attempt。执行方必须重新领取原记录，以永久 TM 在指定账号/渠道核对，再把同一 Attempt 回传为明确结果。失败的 Attempt 可以在同一事实记录上重试；并发领取通过数据库锁和租约拒绝第二个会话。

## 后台操作顺序

1. 用已批准资料生成 UsePackage。
2. 由有发布权限的账号创建 `PUBLISH` 或 `UPDATE` Attempt；同一包同一动作只产生一个 dedupe 记录。
3. 人工完成渠道操作，或给受控 Agent 发放短期分发 Token 并领取 Attempt。
4. 回传成功、失败或结果未知。成功但无稳定 ID 时，填写通过永久 TM 核对的依据；成功且有稳定 ID 时系统建立 Listing。
5. 结果未知时不要重新发；先在原渠道账号中按 TM 核对原 Attempt。

普通“登记 Listing 回执”仍可用于已有稳定远端 ID 的手工路径，并保持旧的幂等、审计和旧下架待办收敛行为。

## 明确未做

- ChannelPrice 的有效价解析、Readiness/Package 使用渠道价格和批量调价；
- Inquiry → Sale → Item SOLD 原子转化；
- 售出后由成功 Attempt 自动计划 DELIST；
- Distribution Center UI、真实平台连接器、AnQiCMS 接口和 archive ID 实测；
- 自动化登录 APP、第三方凭据托管、支付、订单或库存反写。

这些项目必须在后续独立切片中用本地/脱敏测试先验证，真实账号或凭据不得进入源码、测试、日志、配置样例或数据库明文字段。
