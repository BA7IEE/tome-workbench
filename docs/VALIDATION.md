# 当前验证记录 — 1.1.0-rc.4

本地完整验证完成：`2026-09-17T20:48:05.415Z`。验证源码指纹为
`b6ab397d8be55fab362ad78715f5f49b44681813dbfecb6d9491d8c7abcb1d70`；
`verify:release` 的完整 Harness 退出码为 `0`，运行前后源码指纹一致。
后续仅提交本报告、审计记录和发布包不会改变该运行源码指纹；远端 PR head 的 CI
仍须单独核验。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | `verify:release` 内全部通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 27/27、25/25、147/147、8/8；失败均为 0 |
| Chromium | 174 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 174 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| 完整 Harness | exit 0，181 项静态守卫全部通过，sourceUnchanged=true |
| HA | 8 项隔离真实进程故障检查通过；两 API 副本切换 921ms、Worker 恢复 1960ms，未执行外部动作 |
| Recovery | 本地离线恢复演练通过：运行中进程阻止备份、所选表哈希一致、TM 序列推进、原图哈希一致 |
| npm audit | `npm audit --audit-level=high --json` exit 0，0 vulnerabilities |
| Docker runtime | 本次未重跑，不作为本次验证证据 |
| 打包 | `npm run pack` 成功：`release/tome-workbench-1.1.0-rc.4.zip`（1.9 MB）；426 个源文件加 SHA256 manifest 共 427 个 ZIP 条目，未含实际 `.env`、`data/`、`node_modules/`、session、backup 或私钥产物 |

完整摘要、审计结果与门禁日志：[summary.json](validation/1.1.0-rc.4/summary.json)、
[audit.json](validation/1.1.0-rc.4/audit.json)、[verification.log](validation/1.1.0-rc.4/verification.log)。

## v1.1-rc.5 发布安全

本次完成发布安全切片。在既有 TM、来源证据、Candidate 人工确认、库存锁、Sale、
成本、UsePackage、图片权利、Commands/Receipt、Audit/Outbox、ChannelPrice、
Inquiry→Sale、sourceAttemptId 与 Agent Ingest v1.2 的边界上增量实现，不重写事实中心。

- `PublicationHealthService` 把成功的 PUBLISH/UPDATE（包括 APP `remoteId` 为空）纳入
  远端暴露判断；新 Handoff 的 7 天 UsePackage TTL 不会单独把已成功记录标成更新。
- 库存、Target、Channel 用途、供应商 Offer、审批/鉴定、发布图片权利、交易价格与币种
  不再满足条件时为 `MUST_STOP`；批准版本、渠道价、文案或图片变化为 `NEEDS_UPDATE`。
- Worker/Sweep 只创建带来源关联的本地 DELIST，不执行平台操作；Channel 停用或不再是
  TRADE 时仅允许未解决 DELIST 使用 stop-only 会话。
- Trash 会本地取消未交付的 PENDING 发布 Attempt，并阻止仍可能在线的 Handoff、UNKNOWN、
  SUCCEEDED 或未解决 DELIST 暴露；交易价必须大于零。
- 未新增 migration，未执行平台动作、生产部署或真实经营 UAT。

## 生产与业务边界

本轮未部署公网或生产环境，未连接真实第三方、账号、支付、退款、消息或 AI，
也未使用真实经营资料；自动化仅使用隔离 `tome_test` 与本地恢复目标。上述通过证明
当前源码在本地隔离环境的行为，不构成真实 AnQiCMS API、账号、archive ID、真实经营
UAT、PR 合并或部署批准。真正的 REST Connector 与经授权的脱敏 UAT 仍需单独切片。
