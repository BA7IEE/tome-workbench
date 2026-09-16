# 成色列表 CI 回归修复验证 · 2026-09-16

基于已合并 main `314b5cecb8e8ea7f57173ea0d56e7f49b6188469`。失败运行 34993818717 的真实成色写入已经成功，但测试在页面尚未收到保存回执时跳转，被正常的保存中离开保护阻止。

本次仅修正浏览器测试及契约记录。以真实 PATCH 回执控制复现该时序，验证保存中不能离开且只写一次；释放回执后等待“已保存”和保存按钮恢复，再检查列表及重新打开后的成色。原有业务断言全部保留，无 skip、重试、加长超时或刷新。

先执行 prepare-test，再执行完整 `npm run verify:release`，退出 0，源码在验证期间未变化。syntax、typecheck、lint、build 全通过；Unit 20、Harness 自测 12、integration 122、Chromium 164、WebKit 164、HA 8 全通过。双浏览器均无失败、跳过或 flaky，范围一致。Recovery 65 个模型和 2286 个素材文件校验通过，静态守卫 136 项通过；npm audit 所有级别 0 漏洞。

源码指纹：`d1322a0e63aba7e7620ceeb6ec3383a7ed68775c3145c504cd1fae5f3dbed2d6`。

[完整摘要](validation/1.0.1-rc.1/summary.json) · [完整日志](validation/1.0.1-rc.1/verification.log) · [浏览器范围](validation/1.0.1-rc.1/browser-scope.json) · [audit](validation/1.0.1-rc.1/npm-audit.json)。当前这些文件记录本轮验证，下面保留整合背景；原整合验证产物可从 main 基线提交读取。

src、web、Prisma Schema、历史迁移、依赖和版本均未改动。未合并本次修复，未部署，未触碰真实商品库。

---

# 实际验证记录 · 1.0.1-rc.1

2026-09-15 完成本地整合验证。以 rc.19 `bfffa5cd8cb997db440c9b06ef6dd067e722e281` 为第一父提交，整合 UX `1783947288266a2846ae008c1c01d76227b6ef2d`；采用保留两条提交链的 merge，不重写 UX 分支历史。保护分支 `codex/backup-rc19-bfffa5c`、`codex/backup-ux101-1783947` 均已推至 origin。具体冲突决策与测试映射见 [UX-1.0.1-REWORK](UX-1.0.1-REWORK.md)。

## 最终完整运行

已先执行 `node scripts/prepare-test.mjs`，随后 `npm run verify:release` 完整退出 0。`passed=true`、`sourceUnchanged=true`，源码指纹 `289bc6599bde53466aa33a58273cf92ba4ef0cf9d7c1fd6bd21bb9a54b683d1d`。所有检查在同一次最终运行中完成，无跳过、失败或 flaky；不复用旧分支测试结果。

| 检查 | 结果 |
| --- | --- |
| syntax / typecheck / lint / build | 全部退出 0 |
| Unit | 20 / 20 |
| Harness 自测 | 12 / 12 |
| 实际 PostgreSQL integration | 122 / 122 |
| Chromium | 164 / 164 |
| WebKit | 164 / 164 |
| HA 进程故障 | 8 / 8 |
| Recovery 离线恢复 | 65 个模型、1824 个素材文件哈希一致；TM 序列和维护锁通过 |
| Harness 静态守卫 | 136 / 136 |
| npm audit --audit-level=high | 退出 0，所有级别共 0 漏洞 |

[完整摘要](validation/1.0.1-rc.1/summary.json)；[完整日志](validation/1.0.1-rc.1/verification.log)；[双浏览器逐用例范围比较](validation/1.0.1-rc.1/browser-scope.json)；[audit](validation/1.0.1-rc.1/npm-audit.json)。两种浏览器均执行相同的 16 个文件、164 个用例；包括原 UX 三项、预留/解除恢复组合回归和新增登录真实回执延迟回归。

## 功能保留与数据库

rc.15–19 的全部原图资料包、导入批次成员和逐件缺项依据、账户隔离文件队列、关页恢复、Arco 筛选/排序/分页、原图查看字节与元数据保护、只读详情和明确编辑返回路径继续执行。原发布、字典、库存锁、权限、财务和并发回归均保留。新增 UX 的默认工作台、直接经营操作、候选售前状态选择、已有 TM 点选、上传前校验和进度、非财务成交事实与以上路径一起通过。

11 个 migration、Prisma Schema 和 `harness/sealed.json` 与 rc.19 逐字节相同，见 [migration 保留清单](validation/1.0.1-rc.1/migration-preservation.json)。本次整合新增 migration 为 0。相对 main 的数据库差异仅包含 rc.15 已交付的 `202609150011_product_materials` 加法迁移与相应模型；未改、删除或重编号历史迁移。测试库迁移已全部应用，没有待应用项。依赖版本仍为 rc.19 锁定值，仅包版本改为 1.0.1-rc.1。

## 排查与修正记录

新工作区首次单独启动浏览器检查时尚未生成测试夹具；按项目顺序先执行完整 integration 生成合成夹具后继续，没有复制真实资料。新增预留回归曾误把商品 API 的有效预留列表当作全部历史，修正为预留后 1 条、解除后 0 条有效预留；仍验证真实写入、同一幂等键、PAUSED 及显式恢复。

首轮完整 Chromium 为 162 通过、1 失败，原因是旧手机测试用文本“销售”同时匹配新增主导航和设置分组。定位限定到原设置工具分组，保留实际点击与发布记录可达断言，单独复测通过；随后重新执行上表整轮完整验证。没有删减、skip、强制点击、放宽领域检查或刷新掩盖渲染问题。

整合提交 `de6e34c` 的首次两条 Linux CI 均未通过：Chromium 163/163，WebKit 分别 161/163 和 162/163；失败点分散在三个不同用例的登录前置页面断言，业务操作尚未执行，npm audit 因此前失败未运行。上述远端运行不能作为最终通过证据。

统一登录前置为实际点击后等待真实 HTTP 201 和会话响应结构，再执行原页面断言；新增真实后端已写入、回执延迟 5.5 秒的测试，检查禁用重复提交、会话及工作台可用、只发送一次登录。保留整例 45 秒、原页面断言期限及 retries=0。CI 增加不含凭据的登录诊断与合成失败截图/DOM 上下文，以便查明后续失败。未修改生产认证实现。

后续本地全跑 Chromium 164/164、WebKit 163/164，发现布局用例在异步登录态读取完成前直接测量尚未挂载的侧栏。补齐商品标题和侧栏可见的前置条件后，原尺寸和间距断言单独通过；随后再次完整运行，最终为上表双浏览器各 164/164，全部其他检查同时通过。最新远端 CI 需在推送最终提交后另行核对。

## 交付边界

以上全部自动化使用本项目 `tome_test` 合成数据及全新隔离恢复目标。实际查看本轮生成的手机商品库和只读详情截图，Arco 外观、原图入口、直接经营操作与导航保持可用。此证据不代表真实经营、长期人效、跨设备草稿或公网生产验收。

原 rc.19 工作区与本机 4318 经营实例没有切换，真实商品、图片、库存、成本及历史订单没有写入。main 仍保持 `28158fb18df4239933a781e9793e2be40d700cba`；当前交付是待用户确认的 PR，不执行 Squash Merge、下一阶段开发或部署。GitHub 对最终提交的 CI 状态以 PR #1 为准。

源码包使用 `npm run pack` 的已验证指纹门禁；包内排除真实 .env、data、node_modules、会话、密钥与备份，仅允许合成测试源码和公开配置示例。

## 2026-09-16 登录稳定化取证（尚待最新 head 完整验证）

- 旧失败 run 35052422246 的表单现场显示邮箱混入密码输入、密码字段为空，无服务器错误提示。根因类别 1：原生 autofocus 与快速填写发生焦点竞争，浏览器必填校验阻止 submit；不是增加响应超时能解决的问题。诊断补充 request/response/requestfailed、form submit/invalid、服务端收发、ready/SELECT 1 与进程存活，均不记录凭据。
- 仅在测试等待原生 focus 的尝试不完整：Chromium 的带 hash 地址不保证原生 autofocus，且 macOS headless 不保证 OS 窗口激活；已废弃该实现。修复改为登录页挂载时同步 focus，并只检查 DOM activeElement。
- 中途全量验证因上述 focus 断言失败主动中断，不算通过。修正后 ux101 定向 Chromium 5/5、WebKit 5/5，包括实际登录响应延迟 5.5 秒和单次提交。
- 最新完整本地验证、远端 CI、打包结果待运行后记录。未合并、未部署、认证/权限规则未修改。
