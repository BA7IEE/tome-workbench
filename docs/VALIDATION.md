# 当前验证记录 — 1.1.0-rc.4

本地完整验证完成：`2026-09-16T20:40:38.872Z`。验证源码指纹为
`a23da932283109ce11e2d787e723734ba55e34bb030d29c7d4afc44884dbafbd`；
`verify:release` 的完整 Harness 退出码为 `0`，运行前后源码指纹一致。
后续仅提交本报告、审计记录和发布包不会改变该运行源码指纹；远端 PR head 的 CI
仍须单独核验。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | `verify:release` 内全部通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 26/26、25/25、139/139、8/8；失败均为 0 |
| Chromium | 169 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 169 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| 完整 Harness | exit 0，165 项静态守卫全部通过，sourceUnchanged=true |
| HA | 8 项隔离真实进程故障检查通过；两 API 副本切换 916ms，未执行外部动作 |
| Recovery | 本地离线恢复演练通过：运行中进程阻止备份、所选表哈希一致、TM 序列推进、原图哈希一致 |
| npm audit | `npm audit --audit-level=high --json` exit 0，0 vulnerabilities |
| Docker runtime | 本地 `--target runtime` 构建成功；以 `node` 身份验证编译后的 Spike 模块和 Agent 资料，不含运行时 `.env`、session 或 backup；临时镜像已删除 |
| 打包 | `npm run pack` 成功：`release/tome-workbench-1.1.0-rc.4.zip`；416 个条目中没有实际 `.env`、`data/`、`node_modules/`、session 或 backup 产物 |

完整摘要、审计结果与门禁日志：[summary.json](validation/1.1.0-rc.4/summary.json)、
[audit.json](validation/1.1.0-rc.4/audit.json)、[verification.log](validation/1.1.0-rc.4/verification.log)。

## v1.1 AnQiCMS 本地 Spike

本次完成第四个独立切片：在标准 Agent Ingest、Distribution Foundation 和 Real
Operations 之上，保留 TM、来源证据、Candidate 人工确认、库存锁、Sale、成本、
UsePackage、图片权利、幂等、审计和全部既有 migration，不重写其事实边界。

- 新增受限的本地 Spike 资料读取端点与纯合同模块；它只能读取已领取的 AnQiCMS
  Attempt，没有 HTTP 客户端、外部调用、凭据读取或数据库写入。
- 20 件脱敏夹具覆盖 USD 渠道价、公开图片（前 9 张 Gallery、其余正文）、瑕疵披露、
  SEO 字段和所有非 AVAILABLE 状态的 stock=0 语义。
- 稳定 `archive_id` 才能成为 `Listing.remoteId`；首次只能保护性按永久
  `tm_code` 查找，更新复用 archive ID，不能按标题或手工占位推断身份。
- 售出后的本地 DELIST 合同固定为 stock=0、保留页面、显示 SOLD、不开 Checkout；
  它只是待未来 Connector 执行的资料，不会自动改写第三方站点。

## 生产与业务边界

本轮未部署公网或生产环境，未连接真实第三方、账号、支付、退款、消息或 AI，
也未使用真实经营资料；自动化仅使用隔离 `tome_test` 与本地恢复目标。上述通过证明
当前源码在本地隔离环境的行为，不构成真实 AnQiCMS API、账号、archive ID、真实经营
UAT、PR 合并或部署批准。真正的 REST Connector 与经授权的脱敏 UAT 仍需单独切片。
