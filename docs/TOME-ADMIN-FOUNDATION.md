# ToMe Admin Foundation

The shared framework migration uses the real application entry. Runtime acceptance is recorded in [PR #56](https://github.com/BA7IEE/tome-workbench/pull/56) and isolated verification summaries for the matching source fingerprint; this architecture document is not a rolling CI verdict. Dependency locks are cloud-generated and committed, with the exact prerelease exception guarded. Earlier candidate 2612b20 passed 186/188 Chromium journeys and exposed two statically positioned Select portals. The global Foundation portal contract and normal-click geometry assertions address that measured defect. Earlier Shell-only evidence does not validate the current framework.

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

Future modules must use Foundation shell/container, navigation, feedback and component adapters rather than invent page layouts. Current source routes the real catalog through `foundation/records.tsx` ProTable, native submission-owned product/quick forms through Foundation AntD fields and ProForm.Item, and the product overview through lifecycle-owned ProDescriptions. Catalog read/filter/sort/paging/selection remain with the existing controller: the adapter has no request function or second search bar. Native selects retain dictionary/category behavior. The lifecycle also mounts marked legacy record tables through a ProTable bridge before domain listeners bind; dialog mounts use the existing dialog abort scope. Source-row data/aria/id/class attributes and escaped cell HTML are retained. Candidate/source/bulk-price tables explicitly opt into this shared boundary. Read-only `dl.details` use ProDescriptions. Common text fields use AntD + ProForm.Item before native form validation/listeners bind. Text fields preserve ancestor labels required by the existing dimensions/help controller. Unknown amounts, currencies and all rendered content are unchanged.

Runtime acceptance must cover these source changes, not only the Shell. This is a presentation bridge for existing controllers, not an API or domain-model migration. New modules should use the typed adapters rather than copy the legacy HTML bridge.

## Invariants

Keep core.request, write-attempt, work-storage and upload queues. Retain same-key request snapshots and retry, session/role revalidation, version conflict recovery, account-scoped browser drafts and original file bytes. Only show overall saved after text and uploads both finish. ProTable must propagate read failure instead of fabricating successful empty data. ProForm must delegate to existing domain submission/recovery. Never change inventory locks, APIs, database models, unknown amounts, currencies, evidence ownership or source-to-TM confirmation.

Permission presentation uses existing capability checks; server authorization remains authoritative. Read-only, denied and session-expired states are distinct. Route refusal/default behavior must not be changed silently during representation migration.

## Dependency decision

The verified official registry publishes AntD 6.6.5 with React >=18 support. ProComponents stable 2.8.10 declares AntD 4/5 peers; beta 3.1.15-5 declares AntD ^6.0.0 and React >=18. This draft pins AntD 6.6.5, ProComponents 3.1.15-5 and CSS-in-JS 2.1.2 (the shared declared dependency for both) and explicitly accepts a prerelease **validation candidate**, not a compatibility guarantee. No peer bypass or AntD downgrade.

Official metadata: [AntD 6.6.5](https://registry.npmjs.org/antd/6.6.5), [ProComponents stable](https://registry.npmjs.org/@ant-design%2fpro-components/2.8.10), [ProComponents beta](https://registry.npmjs.org/@ant-design%2fpro-components/3.1.15-5). The beta published tarball's ProForm declaration was inspected and exposes Item. Initial cloud type/build checks passed; full runtime acceptance must match the current source fingerprint and PR evidence.

The one-off `foundation-lock.yml` resolved metadata only on a disposable runner (no package scripts/DB/service) and has been removed after its result was reviewed and committed. package.json and lock root match; existing locked package versions were unchanged. Every subsequent verification uses npm ci against the committed lock. The fixed-dependency Harness admits only the specifically documented ProComponents 3.1.15-5 prerelease; ranges and other betas remain rejected.

Full runtime verification of candidate 1e207f2 passed before the dependency audit identified two pre-existing transitive vulnerabilities. Compatible lock-only patches target `proxy-addr` 2.0.8 ([advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)) and `source-map-js` 1.2.2 ([advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)); direct framework versions and Express trust-proxy configuration remain unchanged. The final lock must be cloud-resolved, reviewed for unrelated changes and validated at its own source fingerprint. CI audits immediately after npm ci, before the full sequential regression chain.

## Module admission

Run `node scripts/check-admin-foundation.mjs` in the approved validation environment. It checks shell ownership, real-entry integration, new Arco imports and direct AntD/ProComponents imports outside Foundation. The gate also rejects new raw table/form markup outside the enumerated legacy controllers, extra CSS entries, direct vendor defaults and network calls from Foundation. It checks every Foundation CSS layer for literal colors. The historical `arco/` path remains to avoid unrelated controller/import churn, but runtime vendor imports are now Foundation-only. Retired Arco stylesheet imports and the direct dependency are removed in the current candidate. The gate rejects their return as well as new Arco runtime imports. Historical CSS class names remain only as controller compatibility hooks; empty old layer names retain the original Harness contract. The gate is not proof that all legacy pages have migrated, and is not a replacement for type/build/browser checks.

Use the [module admission checklist](TOME-MODULE-ADMISSION.md) for presentation, business invariants and required evidence. Portalled Select surfaces have a global positioning/semantic-state contract; native dialogs own their popup container. The contract changes presentation only and leaves the existing query callbacks intact.

Review every module for one shell, one stylesheet entry, semantic tokens, consistent table/form/detail adapters, accessible empty/error/read-only/disabled/selected/focus states, existing query/context restoration and unchanged request recovery. No direct module ConfigProvider, second sidebar/topbar or ad hoc feedback provider. The admission script is wired into CI; runtime outcomes are recorded separately in the matching Actions evidence.

## Validation and deployment

Local heavy execution remains prohibited by the project resource gate. All local installs/builds/tests/browser checks for this change are NOT_RUN. GitHub-hosted Ubuntu verification reuses the existing disposable database and real login journeys, with external effects disabled. The added Foundation suite runs in both existing browser configurations. Existing list/form/detail/domain regression suites remain intact.

CI has one sequential verification job, a 45-minute timeout, cancellation of superseded PR runs and three-day retention for selected JSON summaries. Screenshots, source archives, business media and database dumps are not uploaded. No production credentials or data are required. Push/PR authorization does not authorize merging or deployment.

Runtime admission requirements:

1. Validate the committed catalog/editor/overview vertical slice in both browsers; keep every original domain recovery test.
2. Validate the shared record/form/detail bridge across daily work/tasks, imports/candidates/intake/recycle, distribution/listings/collections, sales/inquiries/settlements, procurement/sources, dictionaries/settings/operations/jobs/audit. These routes share Foundation shell/tokens and lifecycle-mounted display adapters; original domain controllers and native file/date/number/checkbox/dictionary-select contracts remain. Dynamic editing-conflict tables stay native to protect active recovery DOM.
3. Validate Foundation Alert feedback and command popovers while preserving native dialog/submission, same-key request snapshots, version/session conflict and upload completion. Toast timing is unchanged; errors use assertive feedback and success uses polite status. Command popovers clamp to the viewport, close on outside/Escape and restore a connected trigger before opening native dialogs. Validate empty/error/read-only/disabled/selected/focus states.
4. Validate removal of retired stylesheet/vendor dependency scaffolding against full contrast/geometry/interaction regression. The one-off cloud metadata resolver must produce the matching committed lock before acceptance.

A local visual preview may use the success-only compiled frontend artifact with clearly labelled fictional read-only fixtures and all writes rejected. It is not evidence of authentication, saving, uploads or inventory behavior. Record an actually served URL separately; never present a hypothetical URL as verified.
