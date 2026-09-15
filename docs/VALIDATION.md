# 实际验证记录 · 1.0.0-rc.15

2026-09-15 完成完整验证。`npm run verify:release` 退出 0，passed=true、sourceUnchanged=true。源码指纹 `eba00b0323995a7687efe61719b52e0e79903de89316cb8148e8cd55b72fd5e4`。结果见 [summary.json](validation/1.0.0-rc.15/summary.json)，完整日志见 [verification.log](validation/1.0.0-rc.15/verification.log)。

语法、typecheck、lint、build 均通过。单元 20/20，Harness 自测 9/9，真实隔离 PostgreSQL 集成 122/122，Chromium 146/146，WebKit 146/146，进程故障 8/8，静态守卫 132/132；无跳过、失败或 flaky。`node scripts/prepare-test.mjs` 已先执行，新迁移先在 tome_test 验证。

实际离线恢复比较 65 个模型和 7776 个素材文件。数据库内容哈希、原文件哈希、TM 序列高水位和运行维护锁均通过。新增历史模型不是空表替代测试：备份中 IngestBatchMember 1214 条、MaterialExport 12 条、MaterialExportEntry 12 条，恢复后完全一致。

本轮内容见 [MVP-RC15.md](MVP-RC15.md)。首轮完整执行因两处旧界面入口断言退出 1，修正为真实列表切换和设置入口后，重新运行完整链取得以上结果。保存原始失败日志在本机 data/mvp-full-first.log。未删用例、未强制点击、未刷新页面掩盖旧渲染；测试中的关页重开是明确的丢回执恢复场景。

## 本机业务数据检查

正式本机应用已启动于 `http://127.0.0.1:4318`，版本 rc.15，2个API、2个Worker。升级器在应用新迁移之前成功备份本机独立 tome_dev；随后按维护锁执行加法迁移。10份既有迁移哈希保持不变。

升级前后逐项比较真实 13 件商品、来源关联、图片元数据和成本记录，完全一致。39 张原图 SHA256 均匹配，最小宽度 1500 像素；确认人民币成本合计 10512.88 元不变。私人明细、快照和备份仅在本机 data/backups，未作为自动化夹具或放进源码包。

内置浏览器已打开正式地址，目前需用户重新登录；本次尚未在该登录会话验收真实商品页面。合成账号的完整界面操作已在两个浏览器执行，不与真实经营者验收混用。

## 交付边界

本次未执行真实销售、外部采集、平台发布、合作规则激活、AnQiCMS 接入或公网部署。朋友从其他设备共用仍需部署同一服务、配置各自账号和正式备份；本机恢复通过不代表异地备份已配置。浏览器恢复记录按同浏览器/账号保存，不是跨设备草稿同步。

## 源码包

`npm run pack` 退出0，生成 release/tome-workbench-1.0.0-rc.15.zip。ZIP内320个条目与文件清单逐项校验通过，源码指纹与完整验证一致；无.env（仅示例）、data、node_modules、会话、密钥或备份文件。本机升级前备份的79个文件另经SHA256核对，外部动作保持OFF。
