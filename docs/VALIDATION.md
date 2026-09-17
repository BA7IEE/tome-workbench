# 当前验证记录 — 1.1.0-rc.3

本地完整验证完成：`2026-09-16T19:45:24.719Z`。验证源码指纹为
`ac9abd742abef7127dbce414096cb2134308e822b5831644abdc4bf9aaf56690`；
`verify:release` 的完整 Harness 退出码为 `0`，且运行前后源码指纹一致。
后续仅提交本报告、审计记录和发布包不会改变该运行源码指纹；远端 PR head 的 CI
仍须单独核验。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | `verify:release` 内全部通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 24/24、25/25、138/138、8/8；失败均为 0 |
| Chromium | 169 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 169 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| 完整 Harness | exit 0，161 项静态守卫全部通过，sourceUnchanged=true |
| HA | 8 项隔离真实进程故障检查通过；未执行外部动作 |
| Recovery | 本地离线恢复演练通过：运行中进程阻止备份、68 个模型表哈希一致、TM 序列推进、原图哈希一致 |
| npm audit | `npm audit --audit-level=high --json` exit 0，0 vulnerabilities |
| Docker runtime | 本地 `--target runtime` 构建成功；以 `node` 身份验证编译产物、两条新增 migration 和 Agent 目录；临时镜像已删除 |
| 打包 | `npm run pack` 成功：`release/tome-workbench-1.1.0-rc.3.zip`；包内没有实际 `.env`、`data/`、`node_modules/`、session 或 backup 产物 |

完整摘要、审计结果与门禁日志：[summary.json](validation/1.1.0-rc.3/summary.json)、
[audit.json](validation/1.1.0-rc.3/audit.json)、[verification.log](validation/1.1.0-rc.3/verification.log)。

## v1.1 Real Operations

本次完成第三个独立切片：保留标准 Agent Ingest 与 Distribution Foundation，
不重写 TM、来源证据、Candidate 人工确认、库存锁、Sale 成本、UsePackage、图片权利、
幂等、审计或历史 migration。

- 两条封印的前向 migration 将渠道价格快照与修订连续性落库；有效渠道价优先于
  `Item.currentPrice`，清除价格不会伪造零金额，也不会让旧分发包重新有效。
- Readiness、草稿、预览和分发包都锁定有效渠道价格及其依据；闲鱼 CNY、AnQiCMS USD
  等渠道币种会被独立校验。
- 询盘普通状态接口仅允许 OPEN/FOLLOWUP/LOST；确认成交走原子
  `Inquiry → Sale → Item SOLD` 流程，保留渠道字符串历史快照及可空渠道账号关联。
- 售出会创建本地 DELIST 执行事实；没有稳定 remoteId 的 APP 仍以永久 TM 标题定位。
  即使“发布成功”回执在售出之后迟到，也会补建唯一 DELIST。该行为只是本地执行计划，
  不会自动调用第三方下架。
- 批量审批先做预检，再逐件复用原有审批入口；商品库的批量渠道价格必须由运营者填写
  明确金额，未知值不能落为 0。分发中心按下架、未知、库存、询盘等运营优先级展示待办。

## 生产与业务边界

本轮未部署公网或生产环境，未连接真实第三方、账号、支付、退款、消息或 AI，
也未使用真实经营资料；自动化仅使用隔离 `tome_test` 与本地恢复目标。上述通过证明
当前源码在本地隔离环境的行为，不构成真实平台发布、AnQiCMS archive ID、真实经营
UAT、PR 合并或部署批准。AnQiCMS Spike 仍是后续独立切片。
