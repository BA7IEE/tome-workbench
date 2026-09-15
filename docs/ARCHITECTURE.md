# Architecture and module ownership

This is a single-workspace, API-first modular monolith. Node/Nest API + separate PG-backed Worker + PostgreSQL + filesystem originals/derived previews + Vite/TypeScript browser. Same origin required. No Redis, SaaS, full ERP, checkout or live external connector.

| Module | Owns | Boundary |
|---|---|---|
| auth | User, Session, LoginThrottle | fresh permission checks; opaque httpOnly cookies; exact Origin + CSRF |
| supply | Supplier, Source, SourceRevision, Offer | raw imports never overwrite Item; supplier freshness/locking distinct |
| catalog | Item, Cycle, ItemRevision, Movement | TM identity; versioned partial maintenance; approval snapshot; custody history |
| media | Asset | original never overwritten; preview derived; rights and verification separate |
| publishing | Channel, UsePackage, Listing | immutable use snapshot; generic channel titles; manual observations, dynamic own showroom |
| trading | Sale, ExceptionIntent, Reservation, Adjustment, CostEntry, Observation, Inquiry | default inclusion, fast sold, locking, unknown finance, refund/cost restoration |
| jobs | Outbox, Task | leased/retryable internal reconciliation; no external side effects |
| ai | Suggestion | import only, optimistic stale check; human accept writes draft only |
| common | domain rules, config, Commands | pure domain no network or Prisma; transaction owner handles audit/receipt/outbox |

## Invariants
Item.id is UUID; serial is sequence-backed short human code. Items reference exactly their own current Cycle and approved ItemRevision through deferred composite foreign keys. Sale is not stock status. Stock exits cause a fresh recomputation, not an old event blindly reopening listings. One active reservation/item and one not-returned Sale/item/cycle have unique DB indexes.
UsePackage holds a frozen public-only fact/image/content/price snapshot. Listing points to a package. An explicit republish may change Listing.packageId, with audit; it never overwrites the old package. Dynamic validity enforces current price, approval, inventory, rights and offer TTL before use. CUSTOMER_CARD cannot be used as a trading listing. The showroom is this system's own projection, not another independently running ecommerce site's connector.
Multiple changes are serialized per Item using transaction-scoped PG advisory locks; explicit DB indexes protect key races independently. Core writes, audit, receipt and Outbox commit together. Worker lease and retry persist in PG; it recalculates current desired state and tracks manual delisting separately. Expiry sweep does not require a human edit.
Financial journal supports versioned internal period snapshots and corrections, not statutory accounting or automated legal settlement. Confirmed sale snapshots do not silently inherit edited supplier quotes or later CostEntry changes. Complete refund + intact return restores acquisition cost; further resale reapplies once. Gifts/supplier-independent exits do not generate our sale. Damaged return, commissions, late closed-quarter corrections and payouts require later reviewed business implementation.

## Extensions
Add a category's named required results to pure rules, not a global mandatory sequence. Add typed attributes/schema evolution when actual need arises; current JSON attributes are validated primitives, not full configurable schema designer.
External channel connectors must add authorization, idempotency, remote unknown-state reconciliation and failure journeys before enabling any side effects. Live AI must use candidate authorization, budgets and tested no-AI equivalents. No SDK may be introduced into pure domain.
New functions must keep protected GETs/private credentials out of use packages and public showroom. Route inventory exists in docs/contracts/openapi.json; full request validation uses Zod in controllers, not an auto-generated full DTO client.

## 0.2.0-rc.2 additions and deployment ownership

- IntakeBatch/IntakeFile stage unassigned originals before explicit item binding. Binding does not grant public rights. Assigned private-document permissions also apply through historical intake URLs.
- ItemAlias uses a reserved TM namespace and permanent uniqueness. RequirementWaiver records justified measurements-only non-applicability, never waives authenticity, stock or media rights; revoked decisions remain history.
- CollectionEntry freezes item/package associations. Exports recheck each item and withhold unavailable entries, without changing already-downloaded files.
- SettlementRule is explicitly activated with an agreement reference. Statement confirmation recomputes the digest under the financial command lock, rejects stale/overlapping confirmations and appends correction snapshots instead of rewriting closed evidence. No money is transferred.
- Request-scoped authorization context is server-created. Commands recheck current role, user and session after waiting for receipt locks, before returning a replay. HTTP password hashing is asynchronous. Authentication attempt limits are shared in PostgreSQL.
- Each runtime owns a dedicated shared PostgreSQL maintenance session. Migrations hold an exclusive session, validate immutable migration checksums and refuse active runtimes across working directories. A lost runtime session fails closed.
- Entrypoints support graceful drain and IPC disconnect. Worker leases are fenced by token and row lock; bounded sweeps ensure one corrupt item cannot block later expiries.
- Local supervisor and production container profiles are distinct. Production uses two APIs, two workers, Caddy, a private database, non-root/read-only runtimes and a separate migration account. Shared filesystem and PostgreSQL remain single-host failure domains in supplied Compose.
- Production startup checks runtime DB privileges and exact migration history. A Docker watchdog turns persistent failed probes into process restart, but does not claim infrastructure redundancy or zero failed requests.

## Validation boundary

OpenAPI here is an endpoint inventory, not complete generated Zod request/response schemas. Full schema generation, external commerce APIs, live AI, richer taxonomy, order lines, shipping and multi-currency accounting remain separately scoped. See AC_MATRIX and PRODUCTION; a route or a document being present is not proof that the whole long-term blueprint was implemented.

## 0.3 operational editing layer
- PublishingDraft is a per-item/channel/purpose mutable working copy with optimistic version and explicit approved-revision/price basis; it is never itself a public listing. PublishingService validates it before freezing an immutable UsePackage.
- Asset archival preserves original bytes and historical links. Restoring requires a fresh review. Image ordering uses an expected full set to reject concurrent gallery overwrites.
- Product form patches only changed values, using readable research rows and typed custom fields. Frontend routes attach listeners after rendering and dispose them on navigation.
- Manual copy/download checks current validity, and package downloads support ordered JPEG derivatives. No watermark removal or AI image fabrication is performed.

Source list uses explicit page/query/stage filters for the operator interface. Legacy unpaged callers retain the prior bounded response; the UI never presents that as the whole inventory.

## Interaction recovery in 0.3.0-rc.2
FormData is captured before controls are locked. Logical publishing writes keep independent receipts until outcomes are known. Definite upload rejections allow corrected data; uncertain outcomes reuse the original input. Same-account reauthentication keeps the original form mounted. Dialog close handlers ignore delayed events belonging to previous steps. These are frontend changes, not relaxed inventory, authentication or media-rights rules.

## 0.4 manual operations layer
ProductEntry uses shared product-fields parsing for one-item and sequential editing. No new inventory or finance rules, and no schema migration. Item creation returns its identity before per-image uploads; response loss retains the original command key and input, so retries neither recreate the item nor resubmit completed photos. A version-conflict rebase preserves queued File objects and upload receipts. User confirmation remains explicit.
Catalog filters are server-validated and applied before count/pagination in a repeatable-read transaction. Default size is unchanged for prior clients; invalid filter values are rejected. Cross-page selections and return position live only in the current browser tab and are cleared on account/filter changes. No supplier cost is inferred from quoted values. Source detail is read behind supply permission.

## Recycle bin in 0.4.1
Item.deletedAt/deletedBy/deletionReason preserve identity and relationships. Default catalog, dashboard and preparation queries exclude deleted items. Shared item writes reject tombstones; deletion and restore are versioned commands serialized with inventory and ledger commands. Sales, cost history, unresolved conflicts, active reservations and outstanding listings block deletion. Restore keeps PAUSED and invalidates approval; no automatic relisting. Database CHECK forbids a tombstoned item from becoming AVAILABLE. Worker acknowledges old events without mutating deleted items. Raw images remain private retained evidence.

## 0.4.1 item recycle bin
Item.deletedAt/deletedBy/deletionReason separate reversible visibility from physical-stock state. Trash/restore use item-scoped locks, expected versions, fresh permissions, audit and outbox in one transaction. Sales, cost history, unresolved observations, active reservations and not-yet-offline listings block deletion. DB constraints prohibit a deleted item from being available or approved.
Shared getItem/itemLock reject normal writes to deleted items; only trash/restore and the worker opt into reading tombstones. Default catalog/dashboard/tasks/inquiries exclude them. Package validation refuses them even through historical paths. Old worker events acknowledge without reopening or generating preparation work. Restoring keeps identity and images, remains PAUSED and unapproved; it never erases trading history or grants image rights.

## 0.5 controlled catalog dictionaries and operator-readable logs
DictionaryEntry owns stable kind/code identity, labels, aliases, applicability and active state. DictionaryTerm has a per-kind normalized-name primary key and a composite entry/kind foreign key. ItemDictionarySelection owns the item's explicit selection plus wording/version snapshot; composite foreign keys prevent cross-kind substitution. Core item updates resolve IDs or exact known terms under the dictionary catalog lock, then persist selection, facts, revision, audit and event together. Unregistered text is not a new option.
DictionaryInitializer inserts missing built-in entries through an idempotent startup transaction. It never rewrites existing entries, reactivates a disabled entry, or mutates Item data. This avoids mixing initial data statements with applied migration files. Startup conflicts fail visibly instead of silently merging brands. Administrator changes use versioned, permission-rechecked commands and uniqueness checks.
The initial CONDITION vocabulary follows the five VC labels documented in CONDITION-STANDARD.md; names and definitions cannot be mixed with unrelated percent grades. Defect descriptions remain separate. No automatic cross-platform mapping or full-text English translation is provided.
Native selection controls are shared between one-item entry and sequential edit. The list uses a compact filter mode, with server-side IDs and brand alias queries applied before pagination. Inline option creation keeps the original form mounted. New dictionaries are not inferred from existing inventory and no legacy normalization workflow is included.
LogsController enriches authorized audit/job reads with human names, item TM identifiers, translated actions/states and remediation text. Its paginated read endpoints do not alter the underlying technical audit or job data. Diagnostic JSON remains available behind a collapsed UI section. This does not claim translation of every financial/technical screen in the product.

## 0.5.0-rc.2 test lifecycle and bulk operator flow
Item.dataMode separates BUSINESS and TEST. Metadata is database-constrained and cannot be patched through ordinary editing. Explicit test creation rechecks administrator authority inside the write transaction. Test cleanup is preview-digest guarded and serialized with the financial journal plus item lock. It preserves Sale/CostEntry/Adjustment and confirmed SettlementStatement rows; only test scope, tombstone, desired listing state and simulated task/reservation lifecycle change. Platform observations are not fabricated.
Business reads, calculations and public showroom filter TEST; public image access rechecks scope through validPackage. The test sales view retains archived rows. Statement detail reports isolatedTestLines without rewriting snapshot contents, and an explicit correction recomputes the delta. Restore remains TEST and PAUSED.
Bulk dictionary edits issue ordinary versioned per-item PATCH commands, so unselected items and unrelated fields cannot change. Only explicitly selected field operations are sent. Missing desired values require an extra clear acknowledgement. Per-item errors do not erase successful results.

## 0.6 product workspace and explicit in-context review
StudioController exposes a read-only pre-approval copy/requirements preview and a reviewed-use command. The latter locks the item, verifies its version and an ordered image metadata digest, excludes private documents, requires explicit selected-image rights attestation, refuses revoked/expired/reference/AI media, and retains marked-defect photos. Already verified public-image provenance is not overwritten. Shared approveRevision is used by both old and new review routes.
The browser StudioPublisher composes review, channel-draft write, package freeze and usable-result fetch as separate idempotent stages. Partial success is not public publication. Uncertain stages retry their original input and key; later edits do not masquerade as the original submitted input. Concurrent channel drafts require explicit comparison before adopting a newer expected version.
ProductEntry preserves its main form during saves. Field parsing/version patches remain shared with sequential editing. StudioFields owns presentation only; StudioMedia owns image interactions; StudioStock owns in-place inventory/offer actions; StudioPublisher owns channel-use preparation. A generated package is checked again before copy/download/receipt. Archived originals and financial history are unchanged.
Main and publishing forms are siblings, not nested HTML forms. Disabled controls cannot be used as the data source for pending-copy recovery: explicit value snapshots preserve input while controls are locked. Image operations update only the gallery state, not unsaved main fields. Route guards cover pending writes across all work areas.
The existing detailed-record pages remain for advanced history and financial inspection; the default list opens the editing workspace. New-item and supplier-item primary flows do not require navigation through the old details tabs. No database migration or new external service is introduced in 0.6.

## 0.7 operator-facing interaction layer
The 0.7 pass changes navigation and presentation, not domain ownership. The catalog list is the default operator entry, product rows open the product editor, and low-frequency actions move behind contextual menus. Product edit retains one primary save path and one publishing path; advanced record screens remain available for audit/history but are no longer prerequisites for routine operations.
`ux2.css` is intentionally presentation-only. Business state transitions remain in the existing controllers/services and idempotent commands. No 0.7 database migration exists. Browser tests exercise visible contextual menus rather than hidden legacy controls. The UX gate is required in Chromium and WebKit.


## 0.8 unified visual system
0.8 changes presentation ownership, not domain state or persistence. `style.css` owns primitive defaults, `interaction.css` owns accessibility/recovery affordances, and `ui08.css` is the only final visual owner. Historical usability/admin-flow/studio/ux2 style sheets remain as source history but are not imported by the runtime.
The catalog, product workspace, publishing context, dialogs and low-frequency administrative pages share one spacing, typography, border, status and control system. Desktop publishing remains non-blocking: the product editor shrinks to preserve context while the publishing sidebar is open. Mobile publishing is in-flow rather than an overlay so inventory/save actions cannot be covered.
`test/browser/ui08.spec.cjs` is a required Chromium/WebKit gate for geometry, mobile business ordering, navigation reachability, action hierarchy and CSS ownership. Existing business tests remain authoritative for permissions, concurrency, image rights, inventory, financial isolation and recovery. No 0.8 database migration exists.

## 0.9 operator control semantics
0.9 changes interaction semantics, not persistence ownership. BRAND is a growing taxonomy and uses one searchable combobox backed by a stable dictionary ID. CONDITION, COLOR and MATERIAL are bounded vocabularies and use native selects. No field may expose a select plus a second search input for the same value.

A typed but unselected brand is never persisted or silently ignored in filters. Explicit selection invalidates stale debounced/in-flight search results. Existing IDs are rehydrated to visible labels after rerender. Optional blank dictionaries do not block sparse item creation merely because their option request is delayed or unavailable.

User-facing labels describe business meaning while existing database keys and legacy import aliases remain stable. Brand can be created in context by authorized staff; fixed vocabularies are maintained centrally. Publishing only exposes supplier-image authorization when the current selection actually includes supplier media.

## 0.10 high-frequency capture layer
QuickIntake is a presentation adapter over the existing item-create and asset-upload commands. It deliberately exposes only first-touch fields and does not own inventory, review, publishing or finance rules. Item creation and each image upload keep independent idempotency keys; retry cannot create a second item or duplicate an already accepted image.

QuickEdit is a constrained adapter over the ordinary versioned item PATCH command. It only sends title, brand dictionary selection, category, current price/currency and condition dictionary selection. A version conflict remains blocking; the compact dialog never rebases or overwrites another user's edit.

The full ProductEntry remains the deep-maintenance surface and the regression source of truth for images, measurements, provenance, review and publishing. Supply adoption continues to enter ProductEntry instead of QuickIntake. No database migration or new domain model is introduced in 0.10.

## 0.11 procurement source layer
采购来源层与库存/销售层分离。`ProcurementSource`描述采购渠道；`PurchaseOrder`、`PurchaseLine`、`PurchaseShipment`、`PurchaseReturn`保留来源事实；`ItemPurchaseLink`把采购订单行与TM商品关联。来源状态不驱动本地库存状态。

订单和订单行使用稳定来源键进行幂等更新，并为每次实际变化追加不可变修订快照。订单金额调整使用稳定`adjustmentKey`，重复导入不会重复叠加折扣或运费。一个订单可以关联多个包裹和退货记录。

订单行金额、来源当前价、估计零售价分别存储。`PurchaseCostConfirmation`单独记录人民币取得成本，同一订单行只允许一个有效确认；修改通过作废旧确认后新增，历史不可覆盖。
## 1.0 item-centered operating model
The normalized flow is External collector -> IngestSession/Batch -> IngestCandidate -> human bulk confirmation -> Item(TM) -> publishing/inquiry/reservation/sale. Ingest candidates carry immutable source revisions and independent normalization proposals; Agent credentials cannot cross into normal authenticated business APIs.
`ItemSourceLink` is the long-lived many-source relation. PurchaseOrder/PurchaseLine retain transaction provenance. `ItemPurchaseLink` identifies the acquisition line when applicable. Legacy `Item.sourceId` remains only for compatibility and is backfilled to `ItemSourceLink` by the v1 migration.
Source images are persisted before confirmation. Confirmation reuses the same stored object but creates an Asset as REFERENCE/INTERNAL/unverified until separate rights review. Source status and condition never authorize local inventory or condition values.
Acquisition costing is order-scoped calculation with Item-scoped results. Source policy defines allocation method and overhead; order basis records actual CNY payment or confirmed fx. Active procurement CostEntry rows are versioned by void-and-replace, while Sale.cost freezes the value at sale time.
## 1.0.0-rc.2 operating action projection
`GET /api/work-queue` is a read projection, not a new business ledger. It composes pending IngestCandidate, open Task, unresolved Observation, active Inquiry and finance-incomplete Sale records into one prioritized operator queue. Ownership and completion remain in the original modules; the projection never marks source records complete or copies them into a second mutable task model.
Role checks are applied before exposing inquiry and sale-finance actions. BUSINESS/non-deleted item scope remains mandatory. Delisting and unresolved fact conflicts sort ahead of finance completion, candidate confirmation and ordinary follow-up. The dashboard and full work-queue screen consume the same projection so counts and links do not diverge.


## 1.0.0-rc.3 candidate identity resolution
Candidate identity resolution is a human decision boundary, not an automated merge engine. Exact source-image SHA, existing purchase-line identity, existing source links and same-source item keys may suggest an existing TM. Exact-image matches block silent candidate confirmation unless an operator explicitly declares that the physical item is distinct.

Linking a candidate to an existing Item creates provenance relations and, when applicable, ItemPurchaseLink; it never changes Item inventory state, maintained facts, current price or approval. Non-duplicate source images may be attached only as REFERENCE/INTERNAL evidence. Perceptual-image similarity and destructive item merge/split remain outside this release.

## 1.0.0-rc.5 procurement refund costing
Confirmed payment evidence treats cash and Store Credit as equal value. Optional four-part paymentBreakdown (gross cash, used credit, cash refund, credit refund) derives the existing final-economic-total field; the full breakdown and optional lineRefunds are retained in the immutable PurchaseOrderCostBasisRevision snapshot. No migration or second payment ledger is introduced. Allocation reads the latest basis revision for the explicitly confirmed item refund attribution.
FX is persisted at basis confirmation. Later source payment changes do not re-derive that rate. Source order/policy versions in the evidence invalidate stale confirmation for subsequent cost writes. Legacy evidence with no fixed FX requires reconfirmation. Positive Credit-return adjustments, REFUND kinds and refund-labeled adjustments require explicit final-net confirmation even without an RMA; zero is a valid confirmed net. Different currencies are never summed.
Attributed refunds are subtracted only from their retained purchase lines after allocating gross purchase value. Their sum must match total refunds; unknown/wrong-order/duplicate targets and negative line allocations fail closed. Unattributed, explicitly confirmed net amounts retain proportional allocation. Item cost replacement writes audit and durable Outbox event in the same transaction and never modifies Sale.cost or inventory status.

## 1.0.0-rc.6 collection evidence and operator confirmation
Collectors remain outside the application. The existing JSON documents hold versioned source evidence: `IngestBatch.rawManifest.expectedCandidateKeys/requiredFields` and `IngestCandidate.sourceFacts.capture`. This adds no schema migration or second inventory master. Capture declarations and imported fields are checked together; original SHA matches and actual file dimensions are checked from stored files. Receipt of a declaration is not independent verification of the remote site. Legacy records lacking declarations remain UNVERIFIED.
Batch sealing is serialized with candidate upsert/upload under the batch lock and records the report in audit. Missing declared items/files, empty claimed fields, or wrong image dimensions block sealing. Explicit source unavailability and thumbnails remain GAPS, permitted to seal but requiring a per-candidate human acknowledgement for creation. Sparse/manual intake remains valid; legacy unverified imports are compatible and visibly labelled.
Source reimports preserve collected nonempty fields recursively and keep manually changed proposals. A new revision can enrich a confirmed candidate with new source files, which stay in provenance and do not automatically attach to or mutate Item. Candidate original/preview routes recheck linked DOCUMENT permissions. The item evidence index exposes only existing BUSINESS/non-deleted item links.
Cross-page selection is tab-memory scoped by account and exact filters, capped at1000; writes use chunks of100 and submitted candidate versions. A retry reuses each chunk's key/body and successful results; per-item failures remain visible. Confirmed Item relations, locks, duplicate identity acknowledgement, media rights and historical cost rules are unchanged.

## 1.0.0-rc.7 internal catalog source photos
The authenticated catalog includes non-archived REFERENCE assets in its recognition image and image count. DOCUMENT and AI_MARKETING remain excluded from that projection. Original media permissions, internal rights, verification, public use packages and showroom rules are unchanged. Successful single candidate creation/linking removes only that candidate from tab selection.

## 1.0.0-rc.8 source reference visibility
Candidate confirmation snapshots sourcePlatform/sourceBrand/sourceConditionDetails alongside existing sourceCondition/sourceColor attributes. conditionDescription or conditionNotes is the generic optional source wording; the full raw payload remains the provenance record. Catalog and product editing use a shared reference formatter: maintained brand/condition takes priority, missing local fields may show explicitly labeled source text. No reference text is a dictionary ID, condition mapping, public approval or stock fact. Reingest/link-to-existing still cannot overwrite maintained Item facts. Historical backfills are explicit versioned Item maintenance, never startup migrations.

## Multi-source design contract
The source-independent boundary and current extension limits are documented in docs/MULTI-SOURCE-DESIGN.md. Missing currency on a new candidate uses that source’s configured default, not a global CNY assumption; omitted currency on a later revision retains the established currency. Source ID namespaces stable external keys. Heterogeneous nested supplier data and adapter metadata survive ingestion; an offline feed does not require a purchase order. New-source policy must be explicitly checked before use.

## rc.9 日常交互边界
商品行菜单由catalog-menu.ts绑定在当前页面生命周期内：固定定位避开表格裁切，窗口变化/滚动收起，外部点击和Escape关闭并恢复键盘焦点。筛选重置只清查询条件，保留商品数据范围、视图、排序和页大小；不同筛选仍清批量选择。候选decision缺省表示PENDING，显式空字符串表示全部，前端与现有接口同义。
快速修改沿用普通带版本PATCH、字典校验和form关闭保护；“完整商品页”在放弃未保存修改前要求确认，不新增写入途径。来源快照可以没有attributes，按无参考值显示，不使旧商品列表失败。经营待办继续使用只读work-queue投影，空状态和布局不产生新的业务事实。无数据库迁移。

## rc.10 商品维护与询盘跟进路径
记录询盘的表单由inquiry-form.ts共享，商品工作区使用独立对话框和原POST /inquiries命令；成功后不重载商品编辑器，不提交或丢弃商品草稿。旧详情页沿用同一实现。待办投影的询盘href带id，GET /inquiries支持可选UUID id/itemId并在数据库过滤后应用列表上限，始终保留sell权限与BUSINESS/未删除约束。更新跟进仍调用原状态命令，不产生销售或改库存。
候选仅在可编辑账户的PENDING范围内允许批量勾选；CONFIRMED卡片的历史警告折叠显示，商品维护入口携带原候选查询。编辑器只接受本应用#/candidates返回地址，保存并返回及返回按钮回到原来源/状态/视图/关键词。TEST商品从测试列表进入时保留原筛选，避免跨数据范围返回。
style.css置于legacy层作为结构默认值，ui08.css继续是唯一最终视觉所有者，避免旧高优先级选择器覆盖现有侧栏与组件。无数据库迁移。

## rc.11 complete record queries and operating commands
The work queue uses one parameterized SQL CTE over the existing owners. Scope/search precede priority ordering and pagination; global visible summary and filtered count share the same query snapshot. Sales use repeatable-read queries and currency-separated full filtered aggregates, while ordinary pages and explicit whole-filter exports are separate reads. Legacy unpaged array endpoints remain bounded for compatibility.
Inquiry.version and Channel.version are additive columns with positive constraints. Inquiry updates acquire the existing Item lock, reread and compare the version, and append previous/latest notes and actor to Audit in the same transaction. Inquiry.notes is the latest summary, not the history source. Audit-based history cannot recreate communications that were overwritten before this release. Cleanup digests include current inquiry identity/version/content.
Channel updates use a channel lock and optimistic version, audit changes and enqueue CHANNEL_CHANGED for affected Items; frozen UsePackage records are immutable. Active state still gates future package use and the worker reconciles listing targets. Platform identity is immutable.
Collection preflight is read-only and checks every requested Item against the existing CUSTOMER_CARD package context. Submission rechecks rights and approval through existing package commands; collection creation retains sorted Item locks and package validation. Browser retry keeps package and collection command keys. Partially created immutable packages remain evidence if subsequent work fails; no automatic publication occurs.
Batch pricing and order cost workspaces orchestrate existing versioned commands with per-row receipts, not a second writable master or a cross-order transaction. Cost selection is scoped by account, source/month/filter and limited to 100 orders; selection may span pages. Existing/return-affected bases require individual review. Confirmed FX and configured overhead are explicit operator inputs; source/order changes invalidate the captured plan. No automatic exchange-rate retrieval is introduced.

## rc.12 选品提交恢复

选品草稿按账号隔离，加入前校验去重后的总量不超过40件。提交尝试保存名称、渠道、商品集合和原幂等键；结果未知标记不能被本地内容不一致错误清除。恢复只还原草稿，重试继续原命令，不修改已冻结资料包。原渠道停用后仍可选择原提交渠道进行幂等恢复，新的资料包仍由服务端复核渠道有效性。

## rc.13 请求未知状态保持

WriteAttempt、通用form及两种上传队列的未知结果标记持续保留，直到原请求成功返回。后续401、CSRF失败或其他明确拒绝仅说明本次重试未执行，不能证明先前写入回滚。首次明确拒绝仍可纠正输入再提交；已有未知结果时不可更换命令键或原上传载荷。ProductUploadQueue向商品编辑器传递登录错误，media-uploader提供同账号原位登录入口，重新登录只更新认证信息。无接口、数据库或权限变更。

## rc.14 记录导航上下文

记录页的筛选与上下文独立处理。重置保留id、itemId、合法returnTo、from=tasks及TEST范围，清除搜索和分页。查看全部仅解除身份范围，仍保留数据类型与返回路径。返回地址沿用应用内白名单并进行HTML转义；不增加查询或写入权限，不改变API的数据隔离。


## 1.0.0-rc.15 product-library MVP

The operator entry is Items (available grid by default) → batch import records → Settings. Existing business modules remain reachable from Settings. All item, stock and finance writes still belong to their current modules; the prototype's in-memory mutation layer is not used.

- Catalog queries apply size, location, source and missing-field predicates before count/pagination. A confirmed CNY cost sum of zero is zero; absence of confirmed CNY entries is null.
- IngestBatchMember records stable batch/candidate membership and first observed version. Upserts append membership; the candidate's current batch pointer remains for compatibility. A sealed batch's integrity report comes from its immutable seal audit. Membership links display current candidate decisions; they are not snapshots of every historical source field. Migration backfills only currently provable memberships.
- Capture evidence accepts webpage evidence or explicit filename/hash/row evidence for offline files. Agent ingestion still cannot directly mutate Item, inventory, sales or cost. Batch confirmation accepts per-candidate incomplete acknowledgements bound to versions; missing originals, identity conflicts and possession requirements remain enforced by the shared service.
- MaterialExport/MaterialExportEntry hold immutable, role-scoped reference snapshots. Snapshot creation locks items in stable order, checks versions and data scope, and writes audit/receipt transactionally. OPERATIONS is a safe merchandising projection; INTERNAL additionally requires finance and includes raw source material, internal facts and CNY costs. Neither grants public image rights.
- Downloads compare current facts, original-image metadata/order/rights, aliases, stock and scope with the snapshot. Deleted, reclassified or changed items block old bundle download. Original file length and SHA256 are verified before ZIP streaming; fresh permissions and comparisons are rechecked after hashing. CSV uses decimal currency units; JSON uses explicit integer hundredths and per-item currency. No cross-currency totals.
- IndexedDB stores account-scoped original command inputs and keys for pending candidate batches, material exports and saved-item uploads. Files are serialized to byte buffers and reconstructed without altering content, including WebKit. Completed chunks/files are not recreated. Recovery requires the same browser profile and retained storage; server records remain authoritative after local storage is cleared. Unsaved text is not synchronized between devices.

Migration 202609150011_product_materials adds only these three history tables, indexes, restricted references and append-only triggers. Existing deployed migrations, stock/ledger constraints and frozen publishing data are unchanged. Export entries also participate in the test-cleanup dependency digest.
