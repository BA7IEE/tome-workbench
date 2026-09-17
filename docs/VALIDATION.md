# 当前验证记录 — 1.1.0-rc.4

本地完整验证完成：`2026-09-17T21:43:54.358Z`。验证源码指纹为
`03217e923de1c4f186ff04eb849792a7be3714dde699b69d52726ab9dad18471`；
`verify:release` 的完整 Harness 退出码为 `0`，运行前后源码指纹一致。
后续仅提交本报告、审计记录和发布包不会改变该运行源码指纹；远端 PR head 的 CI
仍须单独核验。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | `verify:release` 内全部通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 27/27、25/25、148/148、8/8；失败均为 0 |
| Chromium | 174 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 174 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| 完整 Harness | exit 0，183 项静态守卫全部通过，sourceUnchanged=true |
| HA | 8 项隔离真实进程故障检查通过；两 API 副本切换 938ms、Worker 恢复 1956ms，未执行外部动作 |
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

## v1.1-rc.5 Handoff 合同闭环

本次完成标准分发交付合同切片，不重写 TM、来源、Candidate、库存锁、成本、成交、
UsePackage、图片权利、Commands/Receipt、Audit/Outbox、ChannelPrice、Inquiry→Sale、
sourceAttemptId 或 Agent Ingest v1.2。

- 标准协议可按当前 Channel 发现并校验 Skill/Profile SHA；同一分发 Token 支持 X 头和
  Bearer，MCP 仍严格只有四个 Handoff 工具。
- AnQiCMS 的标准取包返回现有本地 builder 的 `platformData`；任何 PUBLISH/UPDATE 成功
  （包括人工或兼容回传）都必须写入有效 archive ID，APP 无远端 ID 成功不受影响。
- 旧 claim/lease 兼容路径未删除，但生产示例默认关闭；标准 Handoff 与 MCP 不受影响。
- 超时或已撤销/过期会话只在经营投影显示 `HANDOFF_STALE` 或
  `HANDOFF_SESSION_DEAD`，没有自动重发、外部操作或 Attempt 改写。
- 新增集成场景用隔离 `tome_test` 校验上述路径；无 migration、平台 Connector、真实账号、
  凭据或业务 UAT。

## 生产与业务边界

本轮未部署公网或生产环境，未连接真实第三方、账号、支付、退款、消息或 AI，
也未使用真实经营资料；自动化仅使用隔离 `tome_test` 与本地恢复目标。上述通过证明
当前源码在本地隔离环境的行为，不构成真实 AnQiCMS API、账号、archive ID、真实经营
UAT、PR 合并或部署批准。真正的 REST Connector 与经授权的脱敏 UAT 仍需单独切片。
