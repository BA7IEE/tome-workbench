# 当前验证记录 — 1.0.2-rc.1

本地验证完成：2026-09-16T09:11:44.584Z。源码提交 `884eb9db79bd2d544326163d74ba89eca7572183`；完整源码指纹 `10c0aa2a501a89a6a2f878497b6b357a737da63b999a3553d8cebc9476df677a`。后续仅提交本报告不改变运行源码指纹，远端最终 head 的 CI 仍须独立核验。

| 检查 | 实际结果 |
| --- | --- |
| syntax / typecheck / lint / build | verify:release 中全部通过 |
| 完整 Harness | exit 0，sourceUnchanged=true |
| Node 测试组（unit / selftest / integration / HA） | 24/24, 17/17, 126/126, 8/8 |
| Chromium | 167 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| WebKit | 167 通过，unexpected/skipped/flaky 均为 0，retries=0 |
| HA / Recovery | passed=true；恢复核对全部当前模型和原图 |
| 静态 Harness | 142 项通过 |
| npm audit | 0 vulnerabilities（独立 npm audit 命令 exit 0） |
| 打包 | 仅对上述已验证指纹执行 npm run pack，产物在 release/ |

完整摘要和日志：[summary.json](validation/1.0.2-rc.1/summary.json)、[verification.log](validation/1.0.2-rc.1/verification.log)。当前 main、PR head、CI 不使用历史快照代替：[PR #2](https://github.com/BA7IEE/tome-workbench/pull/2)、[PR #3](https://github.com/BA7IEE/tome-workbench/pull/3)、[PR #4](https://github.com/BA7IEE/tome-workbench/pull/4)。

## 本轮发现并修复

登录的真实根因是原生 autofocus 焦点竞争导致密码为空，原生校验未触发 submit；保持原超时、真实 UI 登录和零重试。商品文字 PATCH 之后、图片仍保存时的总体成功提示已修正。

新增文件数量断言揭示旧 WebKit 丢回执用例的 route.fetch multipart 转发并未完成首写，却伪造了 201。改为原生 XHR 在实际 HTTP 201 后丢弃交付，验证原命令重放、首写恰好两个文件、恢复不增文件及原图 SHA。早先失败轮次不计入本次通过证据。

## 生产与业务边界

未部署腾讯云，未修改真实商品库，未启用外部消息/支付/AI/发布。自动化仅使用隔离 tome_test 与显式 localhost 合成 Compose。

备份工具支持受控维护窗口下数据库和原图的一致性备份、完整 SHA、迁移/模型/TM 序列核验，以及新目标恢复，拒绝覆盖已有数据库。独立演练只验证恢复数据和只读 SQL 核对，没有启动真实业务应用或执行人工 UAT。

PushPlus 默认只预览；没有 Token 和接收人实际送达证据，alertRecipientConfirmed 保持未完成。1Panel 同机备份不能代替服务器之外的副本，COS 下载恢复、域名/防火墙、实际机型容量和经营 UAT 尚未完成。operations-approval 不因源码或合成测试通过而自动批准。

## UX 1.0.2

客户选品在账号/浏览器范围恢复，重新读取商品事实；真实丢回执后关闭页面再进入保留原命令和包。发布图片拖动、键盘和手机指定位置只写发布草稿。批量最终确认直接执行，库存主要动作共用控制器；相关旧测试仅调整已授权的确认步骤，业务断言保留。

真实 UAT 模板见 [UAT-STABILIZATION](UAT-STABILIZATION.md)，当前全部未执行。跨设备草稿、大范围 Nest/React 改造及外部自动化未开发。
