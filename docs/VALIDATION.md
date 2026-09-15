# 实际验证记录 · 1.0.1-rc.1

2026-09-15 完成本地整合验证。以 rc.19 `bfffa5cd8cb997db440c9b06ef6dd067e722e281` 为第一父提交，整合 UX `1783947288266a2846ae008c1c01d76227b6ef2d`；采用保留两条提交链的 merge，不重写 UX 分支历史。保护分支 `codex/backup-rc19-bfffa5c`、`codex/backup-ux101-1783947` 均已推至 origin。具体冲突决策与测试映射见 [UX-1.0.1-REWORK](UX-1.0.1-REWORK.md)。

## 最终完整运行

已先执行 `node scripts/prepare-test.mjs`，随后 `npm run verify:release` 完整退出 0。`passed=true`、`sourceUnchanged=true`，源码指纹 `61e3f1e7d645b339ee0cff36518d481b4fd800f7f52f007d78e2d3948ea67f9a`。所有检查在同一次最终运行中完成，无跳过、失败或 flaky；不复用旧分支测试结果。

| 检查 | 结果 |
| --- | --- |
| syntax / typecheck / lint / build | 全部退出 0 |
| Unit | 20 / 20 |
| Harness 自测 | 12 / 12 |
| 实际 PostgreSQL integration | 122 / 122 |
| Chromium | 163 / 163 |
| WebKit | 163 / 163 |
| HA 进程故障 | 8 / 8 |
| Recovery 离线恢复 | 65 个模型、900 个素材文件哈希一致；TM 序列和维护锁通过 |
| Harness 静态守卫 | 135 / 135 |
| npm audit --audit-level=high | 退出 0，所有级别共 0 漏洞 |

[完整摘要](validation/1.0.1-rc.1/summary.json)；[完整日志](validation/1.0.1-rc.1/verification.log)；[双浏览器逐用例范围比较](validation/1.0.1-rc.1/browser-scope.json)；[audit](validation/1.0.1-rc.1/npm-audit.json)。两种浏览器均执行相同的 16 个文件、163 个用例；包括原 UX 三项以及新增预留/解除恢复组合回归。

## 功能保留与数据库

rc.15–19 的全部原图资料包、导入批次成员和逐件缺项依据、账户隔离文件队列、关页恢复、Arco 筛选/排序/分页、原图查看字节与元数据保护、只读详情和明确编辑返回路径继续执行。原发布、字典、库存锁、权限、财务和并发回归均保留。新增 UX 的默认工作台、直接经营操作、候选售前状态选择、已有 TM 点选、上传前校验和进度、非财务成交事实与以上路径一起通过。

11 个 migration、Prisma Schema 和 `harness/sealed.json` 与 rc.19 逐字节相同，见 [migration 保留清单](validation/1.0.1-rc.1/migration-preservation.json)。本次整合新增 migration 为 0。相对 main 的数据库差异仅包含 rc.15 已交付的 `202609150011_product_materials` 加法迁移与相应模型；未改、删除或重编号历史迁移。测试库迁移已全部应用，没有待应用项。依赖版本仍为 rc.19 锁定值，仅包版本改为 1.0.1-rc.1。

## 排查与修正记录

新工作区首次单独启动浏览器检查时尚未生成测试夹具；按项目顺序先执行完整 integration 生成合成夹具后继续，没有复制真实资料。新增预留回归曾误把商品 API 的有效预留列表当作全部历史，修正为预留后 1 条、解除后 0 条有效预留；仍验证真实写入、同一幂等键、PAUSED 及显式恢复。

首轮完整 Chromium 为 162 通过、1 失败，原因是旧手机测试用文本“销售”同时匹配新增主导航和设置分组。定位限定到原设置工具分组，保留实际点击与发布记录可达断言，单独复测通过；随后重新执行上表整轮完整验证。没有删减、skip、强制点击、放宽领域检查或刷新掩盖渲染问题。

## 交付边界

以上全部自动化使用本项目 `tome_test` 合成数据及全新隔离恢复目标。实际查看本轮生成的手机商品库和只读详情截图，Arco 外观、原图入口、直接经营操作与导航保持可用。此证据不代表真实经营、长期人效、跨设备草稿或公网生产验收。

原 rc.19 工作区与本机 4318 经营实例没有切换，真实商品、图片、库存、成本及历史订单没有写入。main 仍保持 `28158fb18df4239933a781e9793e2be40d700cba`；当前交付是待用户确认的 PR，不执行 Squash Merge、下一阶段开发或部署。GitHub 对最终提交的 CI 状态以 PR #1 为准。

源码包使用 `npm run pack` 的已验证指纹门禁；包内排除真实 .env、data、node_modules、会话、密钥与备份，仅允许合成测试源码和公开配置示例。
