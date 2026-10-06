> Framework source update: real React Shell, AntD Provider, ProTable, ProForm.Item and ProDescriptions adapters are being wired. The dependency lock is committed and cloud install/type/build passed for the first framework candidate; browser acceptance remains pending. Earlier Shell acceptance does not validate these changes.

# ToMe Design System

Stage-one tokens and CSS are wired to the real entry. Visual/browser verification is pending; AntD provider and ProComponents migration remain outstanding.

## Direction

Warm white canvas, charcoal text and muted brown actions. Professional, restrained and dense, centered on product facts and operating evidence. Avoid a default blue admin theme, decorative statistics and page-specific layouts. Body text is 14px/1.55; annotations should stay readable. Status always includes words rather than color alone. Amounts retain currency and unknown-value meaning.

`web/src/foundation/tokens.ts` is the sole semantic color source. The DOM adapter publishes CSS variables and exports an AntD seed mapping for the future provider. Do not duplicate literal palettes in CSS or modules.

| Token                       | Value                       |
| --------------------------- | --------------------------- |
| canvas / surface            | #F6F3ED / #FFFDFA           |
| text / textSecondary        | #292622 / #625A51           |
| primary / border / selected | #765844 / #CFC7BD / #EDE3D7 |
| successText / successBg     | #24543B / #ECF4EE           |
| warningText / warningBg     | #704917 / #FBF0D9           |
| errorText / errorBg         | #922F2B / #FCEDEA           |
| infoText / infoBg           | #31546A / #EDF3F6           |

Text/Tag/remarks need measured WCAG AA contrast (4.5:1). This draft has not measured all rendered states. Transitional status Tags use dark text on pale surfaces.

## Shared behavior

Desktop navigation is 232px expanded and 64px collapsed, with a short brand mark and 20px icons. Links keep accessible names in both states. The topbar is 56px; content spacing is 24px, reduced to 16px on narrower screens. Mobile retains the existing bottom-navigation pattern and one visible logout. Desktop collapse state is in memory only and survives route rendering; it does not persist business data.

Keyboard focus has a visible outline. Skip-to-content focuses the content region without changing the business hash route. Selection has a current marker and color; no hover-only action. Loading/read failure use shared feedback while retaining existing controllers. Empty, denied, read-only, disabled, conflict and session-expired feedback must keep distinct meanings.

Forms retain validation, units, required/unknown semantics and one main submit operation. Details enter edit explicitly and return with the original catalog context. Table horizontal overflow belongs to its container. No extra shell, independent theme or replacement write/retry layer inside modules.

## Pending evidence

Actions must verify 1280/1440/1920 desktop and mobile shell behavior, full icon bounds, brand collapse, single logout, focus and route-state preservation, alongside existing filter/sort/page, form validation/submission and detail-return suites. Colors, disabled/read-only/error/empty states and the final AntD adapter still need targeted runtime verification. Screenshots remain local and are not CI artifacts or Library uploads.
