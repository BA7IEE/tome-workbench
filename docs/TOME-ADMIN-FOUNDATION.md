# ToMe Admin Foundation

Status: framework migration source in progress, runtime validation pending. The dependency lock was generated on a disposable runner and committed; npm ci, typecheck, lint, build and unit tests passed at 273dd15. Harness requires a narrowly documented exact prerelease exception; browser acceptance remains pending. Do not treat earlier Shell acceptance as framework runtime acceptance.

## Current boundary

The real `web/src/main.ts` entry uses `foundation/app-shell.tsx`. This React Foundation shell owns the application shell, permission-filtered main navigation, page container, loading/read-error feedback, a single logout entry and desktop collapse state. A memoized content boundary leaves domain-owned DOM outside React reconciliation even during collapse. The entry disposes domain roots before the shell root. AntD buttons use the same logout request and disabled/error semantics. No standalone mock entry is introduced.

`admin-navigation.ts` returns the existing primary navigation model. Original permission checks, route parameters and active-group rules are unchanged. `main.ts` keeps real authentication, generation protection, route dispatch, lifecycle hooks, leave guards and scroll restoration. Logout and retry use the existing core action/request path. The public showroom retains its independent entry.

Semantic tokens live in `foundation/tokens.ts`; `ui08.css` remains the only stylesheet entry. A final Foundation layer consumes those variables. `foundation/provider.tsx` consumes the AntD token seed, locale and component overrides. StyleProvider enables the named `antd` CSS layer below `foundation`, so vendor injection cannot silently override brand selection/focus rules. All lifecycle-owned React roots use this provider.

## Route inventory

| Area                | Existing routes/controllers                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| Daily work          | dashboard / dailyWork, tasks                                                          |
| Catalog             | items, items/new, items/:id, items/:id/edit / catalogScreen, productEntry, detailPage |
| Intake and evidence | imports, candidates, intake, trash                                                    |
| Distribution        | distribution, listings, collections                                                   |
| Trading             | sales, inquiries, settlements                                                         |
| Supply              | procurement, sources                                                                  |
| Administration      | dictionaries, settings, operations, jobs, audit                                       |
| Public read-only    | /showroom                                                                             |

Future modules must use Foundation shell/container, navigation, feedback and component adapters rather than invent page layouts. Current source routes the real catalog through `foundation/records.tsx` ProTable, native submission-owned product/quick forms through Foundation AntD fields and ProForm.Item, and the product overview through lifecycle-owned ProDescriptions. Catalog read/filter/sort/paging/selection remain with the existing controller: the adapter has no request function or second search bar. Native selects retain dictionary/category behavior. These are source changes pending actual runtime acceptance; legacy DOM modules listed below remain.

## Invariants

Keep core.request, write-attempt, work-storage and upload queues. Retain same-key request snapshots and retry, session/role revalidation, version conflict recovery, account-scoped browser drafts and original file bytes. Only show overall saved after text and uploads both finish. ProTable must propagate read failure instead of fabricating successful empty data. ProForm must delegate to existing domain submission/recovery. Never change inventory locks, APIs, database models, unknown amounts, currencies, evidence ownership or source-to-TM confirmation.

Permission presentation uses existing capability checks; server authorization remains authoritative. Read-only, denied and session-expired states are distinct. Route refusal/default behavior must not be changed silently during representation migration.

## Dependency decision

The verified official registry publishes AntD 6.6.5 with React >=18 support. ProComponents stable 2.8.10 declares AntD 4/5 peers; beta 3.1.15-5 declares AntD ^6.0.0 and React >=18. This draft pins AntD 6.6.5, ProComponents 3.1.15-5 and CSS-in-JS 2.1.2 (the shared declared dependency for both) and explicitly accepts a prerelease **validation candidate**, not a compatibility guarantee. No peer bypass or AntD downgrade.

Official metadata: [AntD 6.6.5](https://registry.npmjs.org/antd/6.6.5), [ProComponents stable](https://registry.npmjs.org/@ant-design%2fpro-components/2.8.10), [ProComponents beta](https://registry.npmjs.org/@ant-design%2fpro-components/3.1.15-5). The beta published tarball's ProForm declaration was inspected and exposes Item. Type checking and runtime behavior remain NOT_RUN.

The one-off `foundation-lock.yml` resolved metadata only on a disposable runner (no package scripts/DB/service) and has been removed after its result was reviewed and committed. package.json and lock root match; existing locked package versions were unchanged. Every subsequent verification uses npm ci against the committed lock. The fixed-dependency Harness admits only the specifically documented ProComponents 3.1.15-5 prerelease; ranges and other betas remain rejected.

## Module admission

Run `node scripts/check-admin-foundation.mjs` in the approved validation environment. It checks shell ownership, real-entry integration, new Arco imports and direct AntD/ProComponents imports outside Foundation. The historical `arco/` path remains to avoid unrelated controller/import churn, but runtime vendor imports are now Foundation-only. Remaining Arco stylesheet scaffolding is retained until cloud visual checks allow its removal. New Arco runtime imports are rejected. The gate is not proof that all legacy pages have migrated, and is not a replacement for type/build/browser checks.

Review every module for one shell, one stylesheet entry, semantic tokens, consistent table/form/detail adapters, accessible empty/error/read-only/disabled/selected/focus states, existing query/context restoration and unchanged request recovery. No direct module ConfigProvider, second sidebar/topbar or ad hoc feedback provider. The admission script is wired into CI; runtime outcomes remain pending until Actions completes.

## Validation and deployment

Local heavy execution remains prohibited by the project resource gate. All local installs/builds/tests/browser checks for this change are NOT_RUN. GitHub-hosted Ubuntu verification reuses the existing disposable database and real login journeys, with external effects disabled. The added Foundation suite runs in both existing browser configurations. Existing list/form/detail/domain regression suites remain intact.

CI has one sequential verification job, a 45-minute timeout, cancellation of superseded PR runs and three-day retention for selected JSON summaries. Screenshots, source archives, business media and database dumps are not uploaded. No production credentials or data are required. Push/PR authorization does not authorize merging or deployment.

Remaining admission sequence:

1. Validate the committed catalog/editor/overview vertical slice in both browsers; keep every original domain recovery test.
2. Migrate daily work/tasks, imports/candidates/intake/recycle, distribution/listings/collections, sales/inquiries/settlements, procurement/sources, dictionaries/settings/operations/jobs/audit through reusable Foundation record/form/detail adapters. All currently share the branded shell/tokens but retain domain-owned DOM controls.
3. Consolidate dialog/feedback adapters while preserving native submission, same-key request snapshots, version/session conflict and upload completion. Validate empty/error/read-only/disabled/selected/focus states.
4. Remove retired stylesheet/vendor dependency scaffolding after full contrast/geometry/interaction regression.

This Draft does not claim that target architecture is complete. No local preview has been started; do not present a hypothetical URL as a verified preview.
