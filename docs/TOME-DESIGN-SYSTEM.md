# ToMe Design System

The real application entry uses the React Foundation shell, branded AntD provider, ProTable records, ProForm.Item text fields, ProDescriptions facts and shared feedback. Full runtime acceptance of the current migration candidate remains pending in Actions.

## Direction

Warm white canvas, charcoal text and muted brown actions. Professional, restrained and dense, centered on product facts and operating evidence. Avoid a default blue admin theme, decorative statistics and page-specific layouts. Body text is 14px/1.55; annotations should stay readable. Status always includes words rather than color alone. Amounts retain currency and unknown-value meaning.

`web/src/foundation/tokens.ts` is the sole semantic color source. The DOM adapter publishes CSS variables and the AntD seed feeds every Foundation React root. Do not duplicate literal palettes in CSS or modules.

| Token                       | Value                       |
| --------------------------- | --------------------------- |
| canvas / surface            | #F6F3ED / #FFFDFA           |
| text / textSecondary        | #292622 / #625A51           |
| primary / border / selected | #765844 / #CFC7BD / #EDE3D7 |
| successText / successBg     | #24543B / #ECF4EE           |
| warningText / warningBg     | #704917 / #FBF0D9           |
| errorText / errorBg         | #922F2B / #FCEDEA           |
| infoText / infoBg           | #31546A / #EDF3F6           |

Text/Tag/remarks need measured WCAG AA contrast (4.5:1). Foundation Tags use dark semantic text on pale surfaces; status words remain visible. Body, active navigation, role annotations, rendered Tags and disabled pagination have browser contrast assertions. Static token pair ratios are 14.83 (body/surface), 6.12 (secondary/canvas), 11.88 (text/selection), 7.79 (success), 7.00 (warning), 6.92 (error) and 7.19 (info); rendered-state assertions remain required. This does not prove every business state or future module meets AA.

## Shared behavior

Desktop navigation is 232px expanded and 64px collapsed, with a short brand mark and 20px icons. Links keep accessible names in both states. The topbar is 56px; content spacing is 24px, reduced to 16px on narrower screens. Mobile retains the existing bottom-navigation pattern and one visible logout. Desktop collapse state is in memory only and survives route rendering; it does not persist business data.

Keyboard focus has a visible outline. Skip-to-content focuses the content region without changing the business hash route. Selection has a current marker and color; no hover-only action. Loading/read failure use shared feedback while retaining existing controllers. Empty, denied, read-only, disabled, conflict and session-expired feedback must keep distinct meanings.

Forms retain validation, units, required/unknown semantics and one main submit operation. Details enter edit explicitly and return with the original catalog context. Table horizontal overflow belongs to its container. No extra shell, independent theme or replacement write/retry layer inside modules.

Records use the Foundation ProTable adapter with domain-owned filter/sort/page state. Disable vendor search, options and toolbar defaults. Keep permanent TM, unknown amounts, currency, empty text and explicit read errors. The pinned action cell must remain reachable without clipping its button.

Text inputs use Foundation AntD controls inside ProForm.Item, with native labels, names and original form ownership. Native file, date, number, checkbox and dictionary selects retain their existing contracts. Validation, locks, request snapshots and retry stay with the shared domain submission controller. Read-only facts use ProDescriptions and preserve original escaped content.

Portalled Select surfaces have a global Foundation positioning/contrast contract outside the App wrapper; native dialogs own their popup container. This fixes the measured static-position fallback without changing query callbacks. Context actions use the shared viewport-clamped command popover. Keyboard activation focuses the first action; Escape returns focus to the connected trigger. Shared feedback retains original text and timing, using assertive error and polite saved status. A read failure must never look like a successful empty list.

Use the [module admission checklist](TOME-MODULE-ADMISSION.md). New modules must pass the [Foundation admission gate](TOME-ADMIN-FOUNDATION.md#module-admission), document route/capability/state coverage and demonstrate normal and recovery journeys in both browsers. An attractive standalone mock is not admission evidence.

## Pending evidence

Actions must verify 1280/1440/1920 desktop and mobile shell behavior, full icon bounds, brand collapse, single logout, focus and route-state preservation, alongside existing filter/sort/page, form validation/submission and detail-return suites. Colors, disabled/read-only/error/empty states and the final AntD adapter still need targeted runtime verification. Screenshots remain local and are not CI artifacts or Library uploads.
