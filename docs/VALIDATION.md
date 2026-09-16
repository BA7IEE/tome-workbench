# 当前验证记录 — 1.1.0-rc.1

本地完整验证完成：`2026-09-16T17:34:15.652Z`。验证源码指纹为
`95c19e79d66e0800f02acf0456ad322797e8ad2746720c877a282a75bd333fee`；
`verify:release` 的完整 Harness 退出码为 `0`，且运行前后源码指纹一致。后续仅提交本报告不会改变该运行源码指纹；远端 PR head 的 CI 仍须单独核验。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | `verify:release` 内全部通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 24/24、25/25、129/129、8/8；失败均为 0 |
| Chromium | 167 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 167 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| 完整 Harness | exit 0，153 项静态守卫全部通过，sourceUnchanged=true |
| HA | 8 项隔离真实进程故障检查通过；未执行外部动作 |
| Recovery | 本地离线恢复演练通过：运行中进程阻止备份、表哈希一致、TM 序列推进、原图哈希一致 |
| npm audit | `npm audit --audit-level=high` exit 0，0 vulnerabilities |
| Docker runtime | 本地 `--target runtime` 构建成功；以 uid 1000 读取镜像内三份 Skill/Profile，临时镜像已删除 |
| 打包 | `npm run pack` 成功：`release/tome-workbench-1.1.0-rc.1.zip`；仅使用上述已验证指纹 |

完整摘要、审计结果与门禁日志：[summary.json](validation/1.1.0-rc.1/summary.json)、[audit.json](validation/1.1.0-rc.1/audit.json)、[verification.log](validation/1.1.0-rc.1/verification.log)。

## v1.1 Agent Ingest Standard

本次只完成第一个独立切片：标准化候选采集，未改正式 TM、库存、Sale、成本、UsePackage、图片权利、审计或历史 migration。

- `/api/agent-ingest` 仍是最终写入合同；服务端下发并校验 `tome-ingest/1.0` Skill 和按来源选择的 Profile。
- 标准 Batch 将 protocol、Skill、Profile 元数据写入既有 manifest；服务端 Profile 必查字段和 Agent 自报字段取并集，不能由客户端降级。
- 薄 MCP 只有六个采集工具，成功响应使用 HTTP 200；图片仍经既有 multipart HTTP 上传。
- `tome-ingest` CLI 在每次写入前校验协议与两个 SHA-256，并在本地仅保存 fingerprint、幂等键、服务器 ID 和状态，不保存 Token。
- 集成测试以合成 TRR 黄金夹具验证协议/Profile 拒绝、MCP 与 HTTP 等价、CLI 重启重用幂等状态且不泄露 Token。

## 生产与业务边界

未部署公网或生产环境，未连接真实第三方、账号、支付、退款、消息或 AI，也未使用真实经营资料；自动化仅使用隔离 `tome_test` 与本地恢复目标。上述通过证明当前源码在本地隔离环境的行为，不构成 AnQiCMS 或其他平台接入、真实经营 UAT、PR 合并或部署批准。

Distribution Foundation、Real Operations 与 AnQiCMS Spike 仍是后续独立 PR 切片；其中的 ChannelPrice、DistributionAttempt、Inquiry→Sale 原子转化和真实渠道回执未在本次实现。
