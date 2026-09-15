# ToMeBoutique coding contract
Read README.md, docs/ARCHITECTURE.md, docs/AC_MATRIX.md and relevant module before changes.

## Authority and red zones
The v1.1.1 business blueprint describes a long-term goal, not implemented features. This release's implemented boundary is docs/AC_MATRIX.md. Never mark a planned/untested feature as passed.
Never connect to SRVF, production, or another app's database/bucket/keys. No personal/production fixtures. `tome_test` is the only resettable automated-test database.
Never silently enable external effects, live AI, messaging, payment, scraping, autopublish or payout. No real credentials in source, logs, tests or release. Use synthetic data.
Applied migrations and frozen publishing records are immutable. Add forward migrations, don't modify a deployed migration. Seal changes require reviewed acknowledgement, not deleting the gate.
Inventory changes must use item-scoped transaction lock and DB constraints. Write audit and durable event with the transaction. Auth is rechecked BEFORE replaying an idempotency response. API success is not third-party success.
Manual stock observations cannot fabricate revenue; financial incompleteness must not block fast sold/stop. Unknown money is NULL, not zero. No cross-currency sum or unapproved agreement interpretation.

## Change loop / Harness
1. State goal, impacted modules, invariant and smallest acceptance test.
2. Implement one vertical slice, no unrelated refactor or dependency upgrades.
3. `npm run typecheck && npm run lint && npm run build`.
4. Unit + real isolated PostgreSQL integration + Chromium browser tests. `node scripts/prepare-test.mjs` first.
5. `npm run harness:selftest && npm run harness:check`; report command exit and failures honestly.
6. Refresh contract, AC map, runbook and release report. No skipped tests or mocks substituted for runtime evidence.
7. `npm run pack`; check no `.env`, `data`, `node_modules`, sessions, credentials or backups in ZIP.

Do not edit tests to merely accept a wrong implementation. A test change must explain why the former expectation was wrong. Do not rename tests without updating AC mapping.

## Release candidate 0.2.0-rc.2
Read docs/PRODUCTION.md before any deployment change. Local dev, tome_test and the guarded localhost Compose rehearsal are different targets. Never count a production-mode synthetic rehearsal as public deployment or activate real agreement terms. Never bypass Docker privileges or the migration-maintenance gate to make a test pass. New worker probes must match database column types. Local installer and all executable scripts are syntax-checked. Package only a source fingerprint that matches actual validation.

## Interaction gate
Keep the real-click and touch regressions in test/browser/interaction.spec.cjs. Both Chromium and WebKit are required in the full harness. Do not force-click disabled controls or refresh the page inside tests to hide stale rendering. Test response loss after a real write and retry without duplication.

## Dictionary contract (0.5)
Keep dictionary IDs and snapshotted wording separate. Unknown brand/color text is not automatically a new dictionary entry. Preserve name/alias uniqueness, category constraints, permission checks, version conflicts and disabled-entry safety. Initializer only inserts missing built-ins; never rewrites user products. Condition vocabulary is VC five-level, not a claimed universal standard. Both browsers must execute dictionaries.spec.cjs; do not replace selection and error-recovery tests with static option checks.

## Test data separation
Only administrators can create explicit TEST items or classify old simulated records through test-cleanup previews. Do not relax ordinary deletion protections. Keep financial-journal and item locks, original transaction amounts, refunds, assets, observations and statement snapshots. Public showroom and business statistics must exclude TEST. Restoring a test item must never promote it to BUSINESS. Add a current-state digest check for new cleanup dependencies.

## Product-workspace UX gate (0.8)
Keep studio.spec.cjs and ux2.spec.cjs in both browser suites. Primary entry must allow a title-only save and an in-place path from item/media to usable channel package. Do not force users through unrelated screens to correct a missing field.
Do not remove role/evidence/media-rights checks to make the short path pass. Shared approveRevision is the sole review rule implementation. Pending input is captured before controls are locked, or from explicit values; FormData from disabled controls must not erase drafts.
Maintain loss-of-response, concurrent-channel-edit, real file chooser, original-media, in-place sale/receipt and save-return draft-preservation cases. Report synthetic interaction evidence separately from human-time or public-production claims.

## Visual-system gate (0.8)
`web/src/ui08.css` is the final visual owner. Do not re-import usability.css, admin-flow.css, studio.css or ux2.css into main.ts. Visual changes must keep `test/browser/ui08.spec.cjs` in both browser suites. Mobile must retain access to 商品、待办、销售、资源、系统 and preserve the business-order product layout.

## Operator-control gate (0.9)
Do not reintroduce a select plus separate search box for the same dictionary value. BRAND is the searchable combobox; CONDITION, COLOR and MATERIAL are native selects. Stable IDs are persisted; visible labels are for operators.

Typed-but-unselected brand text must block save/filter rather than silently disappear. Explicit selection must cancel stale async searches. Blank optional dictionaries must not block sparse save only because their option request is unavailable. Keep ux09.spec.cjs and ux09-audit.spec.cjs in Chromium and WebKit.

Operator pages use business-language labels. Technical enum codes and API identifiers belong in collapsed diagnostics or API output, not the primary view. Simplifying the UI must never relax permissions, version checks, image rights, inventory, finance or idempotency rules.

## High-frequency operator gate (0.10)
The catalog's primary creation action is QuickIntake. Keep first-touch capture limited to images, title, brand, category, price/currency, condition and image origin. Do not move measurements, material details, review evidence or publishing fields back into that dialog.
QuickIntake must retain item/upload idempotency, original media, supplier-image origin and explicit full-editor escape. Continuous entry must reset prior data and show the last saved TM identity. Keep its mobile dialog inside the viewport with independently scrolling content.
QuickEdit may only patch common merchandising fields and must keep version conflict blocking. Full ProductEntry regressions must continue to use the complete `/items/new` route; never replace domain coverage with the compact paths.
Keep `ux10.spec.cjs` in Chromium and WebKit release suites.

## Procurement facts gate (0.11)
采购来源状态永远不是库存状态：Shipped / Sold / Canceled / RMA等只能保存在采购来源层，禁止直接调用库存状态命令。来源平台成色不得自动映射成本地成色。
订单行金额、平台当前价、估计零售价和人民币取得成本是不同概念，不得复用字段或自动覆盖。没有明确人工依据时不得生成人民币成本或汇率分摊。
采购订单更新必须保留人工的businessDecision/possession和TM关联；来源数据变化只能更新来源字段并增加修订。来源图片URL不授予PUBLIC素材权利。
采购候选只有在`INCLUDE + IN_HAND`后才能生成普通Source；最终TM建档仍使用现有商品校验。新增采购迁移必须是加法迁移，不能删除现有库存、账务或Outbox保护约束。
## v1.0 item-center architecture gate
TM Item is the operational source of truth. External marketplaces, purchase orders, shipments, RMA records and desktop agents are provenance/evidence, never competing inventory masters.
All automated collection products (Codex, WorkBuddy, future agents) must use the generic ingest session/batch/candidate protocol. Do not give machine tokens normal user permissions or let an adapter write Item/Sale/Inventory/Cost directly.
Incoming `Sold`, `Shipped`, source condition, color, size or prices remain source facts. Candidate confirmation is the explicit boundary that can create a TM. Unknown standardization may remain incomplete; it must not force fake values.
Do not replace `ItemSourceLink` with a platform-specific one-to-one relation. `Item.sourceId` is compatibility only. New sources attach through the multi-source relation.
TRR cost policy is source configuration plus per-order confirmed payment/fx evidence. RMA/returns/excluded lines require an explicit final economic-payment override. Sale cost is a historical snapshot and must never be recalculated retroactively.
The primary operator path is Items -> Candidates -> Tasks. Purchase history is secondary evidence. Keep the 100-row candidate browser gate and both Chromium/WebKit coverage in the release harness.
## Operating action projection gate (1.0.0-rc.2)
经营待办是只读投影，不是第二套Task事实源。候选、Task、Observation、Inquiry、Sale仍由各自模块拥有，完成动作必须回原模块执行。
新增行动类型必须同时定义：来源真相、角色可见性、BUSINESS/删除隔离、明确跳转入口和排序依据。禁止为了“统一待办”复制成交金额、库存状态或候选决定到新的可写表。
经营待办与工作总览必须共用同一`/api/work-queue`投影。成交补账仅对finance角色显示，询盘仅对sell角色显示；不可通过首页泄漏更高权限数据。


## v1.0.0-rc.3 candidate identity gate
Exact image matches are warnings/evidence, never automatic identity decisions. A candidate with an exact existing-image match must not silently create another TM through bulk confirmation. Linking to an existing TM must keep Item status, maintained facts, price and approval untouched; only provenance/purchase relations and internal reference evidence may be added.
A same-image/different-physical-item case requires explicit per-candidate override and audit. Do not weaken this gate to make bulk import tests pass. Perceptual similarity is not implemented and must not be claimed.


## Product-library MVP gate (1.0.0-rc.15)
The user-approved MVP has three primary entries: 商品库 / 导入记录 / 设置. This supersedes only the earlier five-primary-navigation and primary publishing-action presentation requirements. Preserve access to existing operations, sales, resources and system tools through Settings, with existing role checks. Item editing offers 保存并下载资料; approved publishing remains available under More with all existing checks.
Keep product-library.spec.cjs in Chromium and WebKit. Test real writes with lost responses followed by closing/reopening the page; verify exact original file bytes and unchanged command keys. Browser/account-local recovery is not cross-device draft sync. Keep existing full-entry, channel, dictionary, stock, finance, media rights and version-conflict regression coverage.
MaterialExport is an immutable internal reference snapshot, never a publishing receipt, inventory master or public feed. Default exports omit internal notes, cost and private documents. Finance permission must be checked again before replaying an INTERNAL export. Compare image metadata as well as item facts before downloading old bundles. IngestBatchMember is append-only membership evidence; do not infer lost old membership. Explicitly accepted source gaps must remain per-candidate and version-bound; completeness and identity blockers cannot be bulk waived.

## Arco product presentation gate (1.0.0-rc.16)
React owns catalog and product fields; existing domain controllers keep writes, recovery and evidence. Keep DOM ownership explicit with lifecycle-bound roots and stable ControllerSlot input. Selection-only renders must preserve filter text and dictionary selection. Conflict rebases must retain file objects, upload keys, source/review state and explicit subsequent save.
ui08.css remains the final visual owner using ordered legacy/arco-base/workbench/arco/product layers declared before other rules. Arco's global reset must precede business layout. Keep the native condition/color/material and searchable-brand semantics; adopting Arco cannot bypass any domain checks. Row dropdowns must escape table clipping and support outside close and Escape focus return. Keep arco-workspace.spec.cjs and all prior domain suites in both browsers.
