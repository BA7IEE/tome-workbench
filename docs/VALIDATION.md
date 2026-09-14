# 实际验证记录 · 1.0.0-rc.14

2026-09-14完成完整验证。npm run verify:release退出0，passed=true、sourceUnchanged=true，源码指纹为`9fae364caa322bcece6f4b4ccd36c0ada29e8bf759fa905c8065dbaf36499d9b`。结果见[summary.json](validation/1.0.0-rc.14/summary.json)，日志见[verification.log](validation/1.0.0-rc.14/verification.log)。

语法、typecheck、lint和build通过。单元19/19，Harness自测9/9，隔离PostgreSQL集成115/115，Chromium140/140，WebKit140/140，进程故障8/8，静态守卫124项通过。两种浏览器无跳过、失败或flaky。恢复实际比较62个模型和6484个素材文件，内容、哈希、TM序列与维护锁检查通过。

本轮见[SYSTEM-REVIEW-RC14.md](SYSTEM-REVIEW-RC14.md)：记录重置保留身份范围和返回入口，查看全部保留TEST范围与返回路径，待办返回保留原查询。新增四条实际点击回归，两种浏览器执行；所有写入测试均为tome_test合成数据。

本机4318已运行rc.14，无新增迁移。真实13件商品、品牌、来源成色、39张原图及人民币成本10512.88元核对一致；原图哈希全部匹配，最小宽度1500像素。私人明细只保存在data/system-review-rc14。

本轮未执行真实销售、外部发布、合作规则激活、采集或公网部署。选品草稿仍仅在当前浏览器页面会话保留，未实现刷新后或跨设备恢复。
