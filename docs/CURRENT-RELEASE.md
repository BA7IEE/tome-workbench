# 当前发布事实

当前源码版本：**1.0.2-rc.1**，稳定化候选，尚未完成真实生产和经营验收。

2026-09-16 核验：PR #2、#3、#4 已依次合并到 main，合并后的提交为 `0be151ce47ca5eed282bbb1f5ce4c75276c4cc83`（`0be151c`）。该提交的 [main push CI 35079989770](https://github.com/BA7IEE/tome-workbench/actions/runs/35079989770) 已成功。这是已核验的提交与运行记录，不是动态分支指针；后续提交的验证以对应 CI 为准。

功能基线：rc.15–19 与 UX 1.0.2。默认工作台，工作台 / 商品库 / 导入记录 / 销售 / 设置五入口；销售按权限显示。商品先只读浏览、明确进入编辑。候选默认 PAUSED。UX 1.0.2 已合并，包含账号与浏览器范围的选品草稿恢复、发布图片排序、批量动作单次确认和按商品状态组织的主要动作；保留既有权限、领域写入和原图恢复规则。

## 自动维护约束

以下清单由实际源码目录生成，`node scripts/check-current-docs.mjs` 核对版本、迁移和双浏览器文件范围。目录新增文件时必须更新清单，不能只手填通过数。

<!-- current-facts -->
```json
{
  "version": "1.0.2-rc.1",
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

## 已合并的改动

- PR #2 修复原生 autofocus 延迟抢焦点造成的登录问题，以及图片保存完成前提前显示成功的问题。
- PR #3 实现版本统一、当前文档守卫、图片补偿、后端权限能力、生产备份恢复与 PushPlus 显式启用工具。
- PR #4 实现上述 UX 1.0.2 功能。三项 PR 的最终 CI 均通过；本地完整门禁和打包证据见 [VALIDATION](VALIDATION.md)，合并后的 CI 见上方运行记录。

## 尚未完成

- 实际异地备份、正式独立恢复、告警收件人测试、域名防火墙核验和真实经营 UAT 尚未验收。
- 本轮未部署、未连接真实经营数据库或第三方；外部副作用保持 OFF。代码合并和 CI 成功不代表实际生产或经营验收完成。

长期蓝图与实现差距见 [AC_MATRIX](AC_MATRIX.md)；历史阶段见 [archive](archive/README.md)，不是当前执行指令。
