# 当前验证记录 — 1.1.0-rc.2

本地完整验证完成：`2026-09-16T18:27:15.388Z`。验证源码指纹为
`653c77a5f28a26d1e4ef8ffa0bd08fd5886775a9735424a1f043feb773722e21`；
`verify:release` 的完整 Harness 退出码为 `0`，且运行前后源码指纹一致。后续仅提交本报告不会改变该运行源码指纹；远端 PR head 的 CI 仍须单独核验。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | `verify:release` 内全部通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 24/24、25/25、133/133、8/8；失败均为 0 |
| Chromium | 167 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 167 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| 完整 Harness | exit 0，159 项静态守卫全部通过，sourceUnchanged=true |
| HA | 8 项隔离真实进程故障检查通过；未执行外部动作 |
| Recovery | 本地离线恢复演练通过：运行中进程阻止备份、68 个模型表哈希一致、TM 序列推进、原图哈希一致 |
| npm audit | `npm audit --audit-level=high` exit 0，0 vulnerabilities |
| Docker runtime | 本地 `--target runtime` 构建成功；以 uid 1000 读取新增 migration、已编译分发服务和 Agent Skill，临时镜像已删除 |
| 打包 | `npm run pack` 成功：`release/tome-workbench-1.1.0-rc.2.zip`；仅使用上述已验证指纹 |

完整摘要、审计结果与门禁日志：[summary.json](validation/1.1.0-rc.2/summary.json)、[audit.json](validation/1.1.0-rc.2/audit.json)、[verification.log](validation/1.1.0-rc.2/verification.log)。

## v1.1 Distribution Foundation

本次完成第二个独立切片：标准 Agent Ingest 保持不变，新增受限分发执行事实，不重写 TM、来源证据、Candidate 人工确认、库存锁、Sale 成本、UsePackage、图片权利、审计或历史 migration。

- `202609170012_distribution_foundation` 是单独封印的前向 migration，新增 Channel 扩展、ChannelPrice、DistributionSession、DistributionAttempt，以及 Sale/Inquiry 的可空渠道关联与 `Sale.inquiryId` 结构准备。
- `DistributionAttempt` 记录计划、领取租约、FAILED 重试、UNKNOWN 原记录核对和结果；同一包同一动作去重。`SUCCEEDED` 没有稳定远端 ID 合法，但不会生成 Listing；有 ID 才创建/更新 Listing，`MANUAL:TM...` 被拒绝。
- 分发 Token 只存 SHA-256 哈希，创建回执不留明文；Token 只能访问本 Channel、当前租约和当前包内可分发的图片，不能写 Item、Sale、成本或价格。包含 URL 查询与片段凭据拦截回归。
- 手工发布工作区不再制造假 remoteId；APP 后续核对使用标题中的永久 TM。原有 SHOWROOM/稳定 Listing 回执与旧下架待办收敛回归保持通过。

## 生产与业务边界

本轮未部署公网或生产环境，未连接真实第三方、账号、支付、退款、消息或 AI，也未使用真实经营资料；自动化仅使用隔离 `tome_test` 与本地恢复目标。上述通过证明当前源码在本地隔离环境的行为，不构成真实平台发布、AnQiCMS archive ID、真实经营 UAT、PR 合并或部署批准。

effective ChannelPrice、Readiness/UsePackage 渠道报价、Inquiry→Sale 原子转化、售出后 DELIST 计划、运营中心和 AnQiCMS Spike 仍是后续独立切片，不能因本次结构和合成验证而视为已交付。
