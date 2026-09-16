# 当前发布事实

当前源码版本：**1.0.1-rc.2**，稳定化开发中，尚未完成发布验收。

2026-09-16 核验的 main 基线为 `314b5cecb8e8ea7f57173ea0d56e7f49b6188469`。这是审计快照，不是动态分支指针；当前分支、PR 和 CI 以 Git/GitHub 实时结果为准。

功能基线：rc.15–19 与 UX 1.0.1。默认工作台，工作台 / 商品库 / 导入记录 / 销售 / 设置五入口；销售按权限显示。商品先只读浏览、明确进入编辑。候选默认 PAUSED。

## 自动维护约束

以下清单由实际源码目录生成，`node scripts/check-current-docs.mjs` 核对版本、迁移和双浏览器文件范围。目录新增文件时必须更新清单，不能只手填通过数。

<!-- current-facts -->
```json
{
  "version": "1.0.1-rc.2",
  "migrations": [
    "202609100001_initial",
    "202609100002_workflow_reliability",
    "202609100003_statement_guards",
    "202609110004_channel_workspaces",
    "202609110005_item_recycle_bin",
    "202609110006_dictionary_catalog",
    "202609120007_test_data_scope",
    "202609120008_procurement_records",
    "202609130009_item_centric_v1",
    "202609140001_operating_record_versions",
    "202609150011_product_materials"
  ],
  "browserFiles": [
    "arco-workspace.spec.cjs",
    "dictionaries.spec.cjs",
    "interaction.spec.cjs",
    "operations.spec.cjs",
    "procurement.spec.cjs",
    "product-library.spec.cjs",
    "studio.spec.cjs",
    "system-review.spec.cjs",
    "ui08.spec.cjs",
    "ux09-audit.spec.cjs",
    "ux09.spec.cjs",
    "ux10.spec.cjs",
    "ux101.spec.cjs",
    "ux2.spec.cjs",
    "v1-item-center.spec.cjs",
    "workbench.spec.cjs"
  ]
}
```

## 验证入口

`node scripts/prepare-test.mjs` 后运行 `npm run verify:release`，覆盖语法、类型、lint、构建、单测、真实隔离 PG 集成、Chromium、WebKit、HA、恢复、Harness；随后 npm audit 和 npm run pack。两个浏览器范围相同，retries/skipped/flaky 均为零。源码指纹必须与验证一致。

实际结果见 [VALIDATION](VALIDATION.md)。旧报告不能证明新源码已验证。所有历史 migration 和封印保持不变。

## 尚未完成

- WebKit CI 登录稳定性仍在取证；PR #2 不满足合并门禁。
- 稳定化规格中的生产备份恢复工具、告警证据闭环、图片补偿、权限能力、UX 1.0.2 按独立切片交付。
- 实际异地备份、正式独立恢复、告警收件人测试、域名防火墙核验和真实经营 UAT 尚未验收。
- 未部署、未合并 main、未连接真实经营数据库或第三方；外部副作用保持 OFF。

长期蓝图与实现差距见 [AC_MATRIX](AC_MATRIX.md)；历史阶段见 [archive](archive/README.md)，不是当前执行指令。
