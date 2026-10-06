# ToMe module admission

Use this checklist with [Admin Foundation](TOME-ADMIN-FOUNDATION.md) and the [Design System](TOME-DESIGN-SYSTEM.md). A source-gate pass alone does not accept a module.

## Presentation contract

- [ ] Register the existing route and capability in the shared navigation model. Use the real App Shell and page container; do not add a sidebar, topbar, theme provider or stylesheet entry.
- [ ] Use `foundation/records.tsx` for local records and read-only facts. Query/filter/sort/page state belongs to the domain controller; disable vendor-generated search, toolbar and options.
- [ ] Use Foundation fields and existing shared submission ownership. Native names, ancestor labels, validation, units and required/unknown meaning must survive. Dictionary/category, file, date, number and checkbox controls retain their declared contracts.
- [ ] Use semantic tokens and shared feedback/command menus. Include status words, readable annotations, reachable pinned actions and visible keyboard focus.
- [ ] Show loading, successful empty results, read failure, denied, read-only, disabled, selected, conflict and session-expired states with their distinct meanings. Never turn a read failure into an empty success.
- [ ] Return to the original list query, selection and scroll context. Desktop collapse must preserve unsaved input, retain named links and keep every icon inside its bounds.

## Business contract

- [ ] Do not change APIs, capabilities, database schemas, inventory locks, money/currency meaning, unknown amounts, evidence ownership or permanent TM identifiers for a presentation change.
- [ ] Delegate network and submission to existing domain controllers. Retain same-key request snapshots, uncertain-outcome retries, version conflict recovery and same-account session revalidation.
- [ ] Preserve account-scoped drafts and original file bytes. Show overall saved only after text and uploads complete; retain pending upload recovery.
- [ ] Pass the page/dialog AbortSignal to lifecycle adapters and release roots/listeners when leaving. A React re-render must not reconcile controller-owned descendants.

## Evidence contract

- [ ] Run the lightweight Foundation admission gate and required type/lint/build checks in the approved environment. The gate rejects new vendor imports/styles, duplicated shells, independent CSS entries, raw page table/form markup outside explicit legacy exceptions and Foundation network effects.
- [ ] Exercise the real entry in Chromium and WebKit: filter/sort/page, validation and save, detail return, permissions, rejection/session expiry and relevant write/upload recovery. Use normal actionability; no forced clicks, injected sessions, weakened geometry bounds or retries masking defects.
- [ ] Exercise 1280/1440/1920 desktop and mobile as relevant. Measure rendered body/status/annotation contrast and check popup/action bounds, focus, collapse and overflow.
- [ ] Record exact commit/run, test counts, skips/flakes/retries, build results and any NOT_RUN boundary. Clearly label synthetic previews; they do not prove authentication, saving or inventory behavior.

Use disposable synthetic test data and external effects OFF. The local resource gate still applies; do not run concurrent heavy suites or reclaim another project's processes/ports. Screenshots stay in the execution environment and are not Library or CI artifacts. Module admission never grants merge, deployment or production-data authorization.

## Existing controller bridge

Marked legacy tables and read-only definition lists mount through the shared lifecycle before domain listeners bind. Escaped cell content and row data/aria/id/class attributes remain intact. Irregular tables and dynamic conflict DOM stay native to avoid losing content or active recovery controls. This bridge is a compatibility boundary for current routes; new modules should use typed Foundation adapters instead of copying legacy markup.
