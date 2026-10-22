# 当前验证记录 — 1.1.0-rc.15

全系统 UX 裁剪方案见 CORE-UX-SIMPLIFICATION。应用代码冻结在 `47b4f395d640ece3796ccd7f3519b94393d30a38`；本次收口仅补跨页选择测试的真实筛选完成前置及本目录证据，不改应用、迁移或权限。

47b4f39 的 [CI 39761672586](https://github.com/BA7IEE/tome-workbench/actions/runs/39761672586) 已终态 SUCCESS，全部步骤包括完整门禁、空库 bootstrap、audit、pack 和 preview 上传成功。API 元数据见 `validation/1.1.0-rc.15/ci-source-run.json`。附件和 raw job log 下载在本环境返回 HTTP 403，未取得文件且未重试或绕过；不能声称已下载该远端报告。

本页提交时是门禁输入；最终 Head 以对应 CI checks 及其运行时生成报告为准。新增测试前置不再重复本地整套门禁，源代码指纹覆盖该测试变化。

本地完整验证待执行。验证源码指纹为
`823f060ad50d715ba62a8a58b6fae8ae82b46ff7f4aa6c8a92ea1c12b47b210d`。

| 检查 | 提交时证据（最终 Head 以 CI 为准） |
| --- | --- |
| syntax / typecheck / lint / build | 47b4f39 本地通过；测试前置修正后 syntax/lint 通过 |
| Node 测试组（unit / Harness selftest / integration / HA） | 本地 51/51、33/33、179/179；失败运行未到HA；47b4f39 CI完整通过 |
| Chromium | 本地217/217，unexpected/skipped/flaky=0，retries=0；47b4f39 CI完整通过 |
| WebKit | 本地216/217，1项筛选前置失败；修正后定向1/1；47b4f39 CI完整通过，保留差异 |
| 1,000 Item 规模基准 | 47b4f39 本地通过；最终 Head 以CI为准 |
| 完整 Harness | 47b4f39 CI通过；本地补充运行未完成，不能记为全绿 |
| HA | 47b4f39 CI通过；未重复本地运行 |
| Recovery | 47b4f39 CI通过；本地另完成70模型、2686原图及4条非空实物回收事实恢复 |

`summary.json` 明确 pending，不伪造新 Head 通过；CI 的 verify:release 会生成真实完整摘要。
`verification.log` 是本地47b4f39的失败运行，不能当新Head通过日志；明细见 `local-supplement.json`。
版本化路径为 `validation/1.1.0-rc.15/summary.json`、`validation/1.1.0-rc.15/audit.json` 和
`validation/1.1.0-rc.15/verification.log`；CI打包目标为 `tome-workbench-1.1.0-rc.15.zip`。
47b4f39的CI已完成pack；本地失败运行没有生成可交付ZIP，不伪造打包通过。
双浏览器同18个文件、retries=0，不增加超时、跳过或模拟成功。
本地仅隔离 tome_test / 自动恢复的新测试库及合成素材，外部动作关闭。

本地失败原因：测试未等带q的筛选请求与渲染完成就读取checkbox的ID，捕获了上一屏“录货回执”商品；点击后实际选中并进入本次“跨页”商品。只增加真实HTTP完成和32件结果断言，原逐件写入、商品顺序和返回校验全部保留。原失败日志、截图、上下文已保全；没有通过刷新或重试掩盖。

本地浏览器二进制及WebKit共享库仅解包到工作区；ldconfig不能识别本地库，确认真实WebKit可启动后跳过主机依赖探测，不绕过应用权限或交互。Node24显式TAP只改变报告格式。

新增第23条forward migration的回滚隔离schema回放见 `migration-upgrade.json`：四类旧成交在执行实际迁移后，历史金额、原全额退款CHECK和原字段保持；不回填历史，有账务维护记录拒绝未记账回收，临时schema回滚。不是生产或完整旧应用部署演练。
实际离线恢复见 `recovery.json`；`inventory-return-restored.json` 以只读聚合核对4条非空回收事实和金额/cycle字段在源库与恢复库一致。
原22条迁移不改，未连接生产业务库。

2026-10-22 10:33 UTC 公网只读health显示rc.14、ready=200，见 `public-deployment-metadata.json`。旧9月rc.12运行记录已过时；公开接口不提供commit，生产SHA、两API镜像一致性、备份与已执行迁移清单仍须现场复核。未执行合并、部署或生产经营动作，实体手机/真实经营UAT未核验。

先前证据仍保留：首候选CI39755043845的Foundation准入失败已通过原适配器修复，未放宽守卫；0958e86的完整本地运行在179项PG通过后为最后两项P2主动中断，不是通过报告。本次本地216/217也明确保留，不用已绿远端CI改写它。
