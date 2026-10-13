# 当前验证记录 — 1.1.0-rc.14

本轮为云端商品 UX 第二批，基线经只读核验为远端 main@87bc1d7f722b1992b0ad58561da632c8262612d0（PR #62 已合并），范围和真实浏览器对照见 PRODUCT-UX-SIMPLIFY，候选见 Draft PR #63。当前实例已成功生成 Prisma、准备独立 tome_test、完成 API/web build 与 Chromium 合成验收；本地 WebKit 受系统库检测阻断。完整验证以 PR #63 最终固定 head 的 GitHub verify:release 结果为准，不复用下文历史候选，也不代表部署或实体手机验收。第一批下载 403 的旧实例记录仅为历史。

PR58/d8d197ce 和 PR59/f98ebb12 的已验证结果独立保留，见 UX-IMPLEMENTATION；它们不验证本页 rc.14 组合撤销/恢复实现。当前候选完整结果待本轮固定 head 的 CI，不操作生产。首候选新增外键类型失败已修正；5bd05ae 的隔离 migration、bootstrap、类型/lint/build/unit 已完成，完整 Harness 在当前报告的旧产物版本引用守卫失败，尚未执行其余业务验收。本报告消除当前版引用与历史版混用，旧报告原样移至 archive/VALIDATION-through-1.1.0-rc.13.md。

本地完整验证待执行。验证源码指纹为
`906bc2afb11dbf0d471f30f6f76e07e0e3e680ca03311a1de28c9abf41055dca`。
本机仅轻量检查；完整通过证据应由本轮 CI 的 verify:release 生成。本页的版本与源码指纹在执行时同步；pending 摘要不表示通过。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | 固定 5bd05ae 的 CI 已通过；当前候选完整验证待执行 |
| Node 测试组（unit / Harness selftest / integration / HA） | NOT_COMPLETE |
| Chromium | NOT_RUN |
| WebKit | NOT_RUN |
| 1,000 Item 规模基准 | NOT_RUN |
| 完整 Harness | NOT_COMPLETE |
| HA | NOT_RUN |
| Recovery | NOT_RUN |

本轮版本化证据路径为 `validation/1.1.0-rc.14/summary.json`、`validation/1.1.0-rc.14/audit.json` 与 `validation/1.1.0-rc.14/verification.log`；通过后才可生成 `tome-workbench-1.1.0-rc.14.zip`，目前未有本候选已通过产物。

误确认与组合恢复范围和不变量见 CONFIRMATION-COMPENSATION，测试映射见 AC_MATRIX。保留原始 TM、来源、采购、原图、原回执；未知写入以原请求号核对。migration 202610120021_confirmation_compensation 已在隔离 CI 应用，原样保留；后续数据库修复只能追加新 forward migration。

未完成真实手机手指/键盘 UAT、精确生产后端 SHA、最终合并/部署批准和生产维护迁移；没有进行任何生产经营写入。源码验证通过不能代替这些验收或授权。
