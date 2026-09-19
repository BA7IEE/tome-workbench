# 当前验证记录 — 1.1.0-rc.8

本地完整验证完成：`2026-09-19T20:21:53.392Z`。验证源码指纹为
`6cbcd8f1aa28e032db3f95faf3b32beac1b1375e25ba3486516ca8ecc168622b`；
`verify:release` 的完整 Harness 退出码为 `0`，运行前后源码指纹一致。
后续仅提交本报告、审计记录和发布包不会改变该运行源码指纹；远端 PR head 的 CI
仍须单独核验。

`verify:release` 会先同步本页的版本与源码指纹；当前文档守卫会把它们同时与版本化
`summary.json` 和当前源码复核，避免顶层验证页沿用旧版证据。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | `verify:release` 内全部通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 30/30、31/31、162/162、8/8；失败均为 0 |
| Chromium | 176 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 176 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| 1,000 Item 规模基准 | Operations 233.998ms、Dashboard 216.569ms、Work Queue 15.596ms，均小于 1 秒 |
| 完整 Harness | exit 0，198 项静态守卫全部通过，sourceUnchanged=true |
| HA | 8 项隔离真实进程故障检查通过；两 API 副本切换 917ms、Worker 恢复 1954ms，未执行外部动作 |
| Recovery | 本地离线恢复演练通过：运行中进程阻止备份、所选表哈希一致、TM 序列推进、原图哈希一致 |
| npm audit | `npm audit --audit-level=high --json` exit 0，0 vulnerabilities |
| Docker runtime | 本次未重跑，不作为本次验证证据 |
| 打包 | `npm run pack` 成功；已逐项核对 `release/tome-workbench-1.1.0-rc.8.zip` 未含实际 `.env`、`data/`、`node_modules/`、session、backup、reports 或私钥产物 |

完整摘要、审计结果与门禁日志：[summary.json](validation/1.1.0-rc.8/summary.json)、
[audit.json](validation/1.1.0-rc.8/audit.json)、[verification.log](validation/1.1.0-rc.8/verification.log)。

本候选新增 production bootstrap gate：在独立 PostgreSQL 空库中先确保 `tome_app` 不存在，再执行正式 `--production --initial-empty` migration；迁移脚本必须自行创建/同步运行角色、完成 18 个 migration、补齐最小权限并用运行账号实际连接验证。该 gate 直接覆盖本次 1Panel 首次部署暴露出的“运行角色缺失但 migration 仍完成”问题。\n\n## v1.1-rc.5 发布安全

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
- 未改写历史 migration；本轮的询盘日程使用独立 forward migration，未执行平台动作、生产部署或真实经营 UAT。

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

## v1.1-rc.5 询盘日程、成交币种与结算安全

本次完成询盘与交易事实闭环切片，新增的
`202609180017_inquiry_followup` 是唯一 forward migration；既有 TM、来源、Candidate
人工确认、库存锁、Cost、Sale、UsePackage、图片权利、Commands/Receipt、Audit/Outbox、
ChannelPrice、Inquiry→Sale、sourceAttemptId 与 Agent Ingest v1.2 均未重写。

- `FOLLOWUP` 必须保存 `nextFollowUpAt`，工作队列按遗漏、逾期、当日和未来日程排序；OPEN、LOST
  与确认成交都会清空日程，界面冲突恢复会读回最新日程。
- 询盘转成交严格写入 `Inquiry.currency`；已配置渠道的直接成交采用有效渠道价币种或账号要求币种，
  未配置渠道才采用 Item 币种。审计同时保留成交币种快照。
- 仅人民币成交会冻结已确认的人民币成本；外币 Sale 的 `cost` 保持 NULL，不能把人民币成本混入外币账。
- 没有 FX basis 的外币对账确认以 `FOREIGN_SETTLEMENT_FX_BASIS_REQUIRED` 阻断并保持 DRAFT；
  本版未实现 FX 引擎或自动折算。Chromium 与 WebKit 都实际验证了该错误、保留草稿和显式放弃表单的交互。
- 本轮完整 gate 使用隔离 `tome_test`，未执行平台、支付、退款、消息、联网 AI、生产部署或真实经营 UAT。

## v1.1-rc.6 分发代际与远端身份收口

本候选在 rc.5 已成立的 Handoff / Publication Health 地基上继续收口，不增加任何平台执行器或真实第三方副作用。

- 关闭经营 Target 会取消尚未交付的 PUBLISH/UPDATE，并为已确认发布代际生成 source-linked DELIST；存在未完成 DELIST 时阻止新发布，避免迟到停售击穿新代际。
- UPDATE 不能静默切换到第二个稳定远端身份；已知稳定 remoteId 在执行方本次未重复返回时可继承，多个未停售远端身份则进入人工核对。
- 同平台第二账号确认同时考虑 active Target、历史成功 Exposure、LIVE Listing 和尚未完成的 PUBLISH/UPDATE Handoff。
- OTHER 交易渠道使用 `GENERIC_TRADE/1.0`；没有专用发布 Profile 的历史停用/内容渠道只允许通过 `GENERIC_STOP/1.0` 完成 DELIST 收口。
- AnQiCMS 手工发布/更新登记在 UI 和服务端都要求真实 archive ID；APP 平台 remoteId 仍可为空。
- 当前证据仍只证明隔离代码与浏览器/数据库行为；真实 AnQiCMS、闲鱼和海外平台 UAT 尚未执行。

## v1.1-rc.7 外部反向代理生产模式

本候选只扩展生产部署与验证拓扑，不改变商品、库存、成交、成本、分发或第三方执行语义。

- `production-config.mjs` 明确区分 `INTERNAL_CADDY` 与 `EXTERNAL_REVERSE_PROXY`，并记录外部代理提供方；1Panel 使用 `1PANEL`。
- 两个 API 只映射到 `127.0.0.1:14318/14319`；PostgreSQL 与 Worker 不发布宿主机端口。
- 内置 Caddy 属于 `internal-proxy` profile；外部代理模式不运行它，避免与 1Panel/OpenResty 抢占 80/443。
- preflight 在外部代理模式仍从正式 HTTPS 域名检查 readiness 与公开 API 版本，同时验证 API loopback 和内置 proxy 未运行。
- 代码验证不能替代实际 1Panel 网站配置、证书签发、防火墙、异机备份、恢复演练或真实经营 UAT。

## 生产与业务边界

本轮未部署公网或生产环境，未连接真实第三方、账号、支付、退款、消息或 AI，
也未使用真实经营资料；自动化仅使用隔离 `tome_test` 与本地恢复目标。上述通过证明
当前源码在本地隔离环境的行为，不构成真实 AnQiCMS API、账号、archive ID、真实经营
UAT、PR 合并或部署批准。真正的 REST Connector 与经授权的脱敏 UAT 仍需单独切片。
