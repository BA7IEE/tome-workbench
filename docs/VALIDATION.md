# 当前验证记录 — 1.1.0-rc.15

本轮范围为全系统 UX 减法，基线 main@004eef6ed299b8cb52c630e3698588acb0e95752。
路由与领域依赖清单见 CORE-UX-SIMPLIFICATION。未连接生产数据库或执行生产经营动作。

本地完整验证待执行。验证源码指纹为
`98985e2f83cd3f7e0f6a39715cdb76a666dffaa43e78e8a854536690ff82c165`。
本页指纹、完成时间和下列结果由本轮 verify:release 同步，pending 不表示通过。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | 已完成局部检查；最终固定源码完整门禁待执行 |
| Node 测试组（unit / Harness selftest / integration / HA） | NOT_COMPLETE |
| Chromium | NOT_COMPLETE |
| WebKit | NOT_COMPLETE |
| 1,000 Item 规模基准 | NOT_RUN |
| 完整 Harness | NOT_COMPLETE |
| HA | NOT_RUN |
| Recovery | NOT_RUN |

本轮版本化证据为 `validation/1.1.0-rc.15/summary.json`、`validation/1.1.0-rc.15/audit.json`
及 `validation/1.1.0-rc.15/verification.log`；通过后才生成 `tome-workbench-1.1.0-rc.15.zip`。
双浏览器覆盖相同18个文件，retries=0，不允许跳过或把失败改写为通过。
测试仅使用隔离 PostgreSQL tome_test 和合成图片/商品，外部动作关闭。

云实例未预装浏览器。浏览器二进制下载到工作区；WebKit 所需 Debian 共享库也仅下载并
解包到工作区，再放入本地浏览器依赖搜索目录，未修改系统包或应用权限。
Playwright 的 ldconfig 主机探测不能识别该本地安装；已实际启动 WebKit 后才运行真实双浏览器验收。
未修改浏览器实现、应用授权、禁用控件或成功响应；测试仍使用真实登录与数据库事务。
Node 24 显式使用 `NODE_OPTIONS=--test-reporter=tap` 输出 Node 测试计数，不改变范围或断言。

未核验生产后端 SHA、实体手机手指操作或真实经营 UAT；未合并、未部署。
本轮新增一条可空实物回收时间及守卫的 forward migration；只在隔离库应用。旧全额退款CHECK、既有 migration、封存快照、历史金额与素材原文件保留。

保留的先前失败/中断证据：首候选 CI 39755043845 在 Foundation 准入拦下价格表；已改用现有适配器，未改守卫。0958e86 完整日志保留于云环境 evidence/verification-0958-interrupted.log（179项集成通过后为最后两项预检P2收口主动中断，不是最终通过报告）。最终以本页新源码指纹及同范围完整验证为准。
