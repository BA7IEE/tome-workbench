# 品牌治理：预览、人工决策与受控回填

本流程只处理尚未关联 TM 的 `PENDING` 候选品牌建议。来源品牌原文、Agent 字段建议与证据、候选修订、采购行、TM 和经营事实保持原样。来源成色另行处理，不参与品牌决策。

## 只读清单与 dry-run

有字典维护权限的账号可读取 `GET /api/ingest/brand-governance/preview`。响应按 `brandRaw + proposal.suggestedBrand` 原文分组，列出数量、已绑定数量、原文和建议对现有启用品牌词项的精确命中、审阅建议，以及每件候选的 ID、版本、采购来源、货号、标题、Agent 品牌建议及其置信度和证据路径、来源页面。`generatedAt` 是生成时间；再次执行须取新的版本快照。接口只读，不创建字典、别名或品牌绑定。

建议只有 `MATCH_EXISTING`、`REVIEW_ALIAS`、`REVIEW_NEW_ENTRY`、`UNRESOLVED` 四类。它们都是待人工判断的线索，不能作为批准记录。来源原文和 Agent 建议命中不同标准项时保持 `UNRESOLVED`。`Unsigned`、设计师副线、同名不同品牌和翻译变体必须逐件核实，不凭字符串相似度合并。原文命中停用项不算可绑定。报告可能含经营来源信息，只保存于受控私有工作区；不得提交到仓库、放入测试夹具、日志、截图或公开 PR。真实报告应记录读取时间、运行环境、部署 SHA、总数和每组决定；本源码分支不访问生产，因此没有把旧快照数字当作当期结果。

每组人工决定表至少记录：`brandRaw`、`suggestedBrand`、来源证据、决定 `MATCH_EXISTING / ADD_ALIAS / CREATE_ENTRY / UNRESOLVED`、目标字典 ID/版本、审核人、原因和批准时间。`REVIEW_ALIAS` 只提示考虑别名；`REVIEW_NEW_ENTRY` 只提示考虑新建。若证据不足，保持 `UNRESOLVED`，候选继续提示品牌未标准化。

## 字典维护和回填

已批准的新标准项或别名通过既有 `POST /api/dictionaries` 与 `POST /api/dictionaries/:id` 维护，复用词项冲突检查、版本、权限、幂等回执和审计。每次变更后重新读取字典 ID、版本和预览，不能沿用旧目标版本。

回填前准备最多 100 件的明确清单，先离线复核全部 `PENDING`、未关联 TM、来源原文/建议、候选版本和目标字典版本。`POST /api/ingest/brand-governance/bind` 要求字典权限和 `Idempotency-Key`；请求形状：

```json
{
  "reason": "人工核对来源和品牌归属的具体依据",
  "rows": [{
    "id": "候选UUID",
    "version": 1,
    "expectedProcurementSourceId": "采购来源UUID",
    "expectedBrandRaw": "来源品牌原文",
    "expectedSuggestedBrand": "当前Agent或来源建议品牌",
    "brandEntryId": "已批准标准品牌UUID",
    "brandEntryVersion": 1
  }]
}
```

同一批在一个事务内逐件加锁复核并写入。返回 `UPDATED` 或带原因的 `SKIPPED`：不存在、非待确认/已关联、候选版本或来源变化、建议变化、已有绑定、字典版本或状态变化。任何跳过项都必须重新预览，不能自动改用最新版本重试。同一键同一载荷返回原 Receipt；同键不同载荷冲突。成功项仅修改候选 `proposal.brandEntryId/brandLabel`、批准依据标记、版本与当前“品牌尚未标准化”提示，写入含 before/after 的 `INGEST_CANDIDATE_BRAND_BOUND` Audit。来源原文、Agent 证据、其他建议、历史修订、PurchaseLine、TM、库存、成本、售价、成交和发布不在写集。后续机器重导继续保留人工批准品牌；若来源品牌或建议变化，会留下需复核提示。

## 生产执行边界

在已验证 PR head、部署获单独授权并核对运行 SHA 后，先用只读预览生成当期私有报告，逐组完成业务审核。字典写入和候选回填还须另获明确授权；先做一组小批量，核对 Receipt、Audit、候选版本和未改字段，再按每批最多 100 件推进。每批使用新的幂等键；未知响应只用原键原载荷恢复。生产前后再次取只读清单，核对未解决、跳过和冲突数量。任何 `UNRESOLVED` 留在待办，不能为了消除提示强行造标准项。
