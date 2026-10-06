# ToMe Admin Foundation

Status: stage-one source implementation, validation pending. This is a Draft migration; AntD6 and ProComponents are not installed or wired yet.

## Current boundary

The real `web/src/main.ts` entry uses `foundation/app-shell.ts`. This transitional DOM adapter owns the application shell, permission-filtered main navigation, page container, loading/read-error feedback, a single logout entry and desktop collapse state. It leaves domain-owned DOM outside React reconciliation. No standalone mock entry is introduced.

`admin-navigation.ts` returns the existing primary navigation model. Original permission checks, route parameters and active-group rules are unchanged. `main.ts` keeps real authentication, generation protection, route dispatch, lifecycle hooks, leave guards and scroll restoration. Logout and retry use the existing core action/request path. The public showroom retains its independent entry.

Semantic tokens live in `foundation/tokens.ts`; `ui08.css` remains the only stylesheet entry. A final Foundation layer consumes those variables. An AntD token seed is provided for the next provider migration, without claiming installed-component compatibility.

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

Future modules must use Foundation shell/container, navigation, feedback and component adapters rather than invent page layouts. The AntD/ProComponents stage will provide ProTable, ProForm and ProDescriptions adapters; this stage has not migrated those views.

## Invariants

Keep core.request, write-attempt, work-storage and upload queues. Retain same-key request snapshots and retry, session/role revalidation, version conflict recovery, account-scoped browser drafts and original file bytes. Only show overall saved after text and uploads both finish. ProTable must propagate read failure instead of fabricating successful empty data. ProForm must delegate to existing domain submission/recovery. Never change inventory locks, APIs, database models, unknown amounts, currencies, evidence ownership or source-to-TM confirmation.

Permission presentation uses existing capability checks; server authorization remains authoritative. Read-only, denied and session-expired states are distinct. Route refusal/default behavior must not be changed silently during representation migration.

## Dependency decision

React 18 meets the [official AntD6 requirement](https://ant.design/docs/react/migration-v6/). The [official ProComponents source package](https://raw.githubusercontent.com/ant-design/pro-components/master/package.json) inspected for this draft declares antd ^6.0.0 and React >=18, with a prerelease version. Source compatibility is not proof of published-package compatibility. Verify stable registry tags, peer dependencies and exports before installation; prerelease use requires explicit risk reporting and runtime validation. Do not downgrade AntD6 or bypass peer checks.

## Module admission

Run `node scripts/check-admin-foundation.mjs` in the approved validation environment. It checks shell ownership, real-entry integration, new Arco imports and direct AntD/ProComponents imports outside Foundation. Existing Arco adapters are grandfathered until migrated. The gate is not proof that all legacy pages have migrated, and is not a replacement for type/build/browser checks.

Review every module for one shell, one stylesheet entry, semantic tokens, consistent table/form/detail adapters, accessible empty/error/read-only/disabled/selected/focus states, existing query/context restoration and unchanged request recovery. No direct module ConfigProvider, second sidebar/topbar or ad hoc feedback provider. The admission script is wired into CI; runtime outcomes remain pending until Actions completes.

## Validation and deployment

Local heavy execution remains prohibited by the project resource gate. All local installs/builds/tests/browser checks for this change are NOT_RUN. GitHub-hosted Ubuntu verification reuses the existing disposable database and real login journeys, with external effects disabled. The added Foundation suite runs in both existing browser configurations. Existing list/form/detail/domain regression suites remain intact.

CI has one sequential verification job, a 45-minute timeout, cancellation of superseded PR runs and three-day retention for selected JSON summaries. Screenshots, source archives, business media and database dumps are not uploaded. No production credentials or data are required. Push/PR authorization does not authorize merging or deployment.

Remaining migration: install a verified AntD6/ProComponents combination, replace the transitional Shell adapter, migrate legacy Arco views and domain-backed tables/forms/details, then perform full interaction/status/contrast regression. This Draft does not claim that target architecture is complete.
