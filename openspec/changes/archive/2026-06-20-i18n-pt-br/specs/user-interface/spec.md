# Delta for User Interface

## MODIFIED Requirements

### Requirement: Error Toast Lifecycle

The error toast MUST animate in on mount, animate out before unmount, auto-dismiss after ~4s, and clear its `setTimeout` on unmount. The close control MUST be a Lucide `X` icon whose `aria-label` MUST be locale-aware via the `t()` function under the key `ariaLabels.closeError`. The visible error label prefix ("Error:" / "Erro:") MUST also flow through `t()` under the key `common.error`.
(Previously: hardcoded `aria-label="Cerrar error"` and visible "Error:" string assumed Spanish only.)

#### Scenario: Auto-dismiss with cleanup

- GIVEN `error` is set
- WHEN the user does not interact for ~4s
- THEN the toast disappears AND `error` becomes `null`
- AND if `page.tsx` unmounts first, the `setTimeout` is cleared (no React warning)

#### Scenario: Manual dismiss

- GIVEN `error` is set
- WHEN the user clicks the close control
- THEN the toast animates out and `error` becomes `null` immediately

#### Scenario: Close control label is locale-aware

- GIVEN the toast is rendered
- WHEN the user inspects the close button
- THEN its `aria-label` resolves through `t("ariaLabels.closeError")`
- AND the value updates when the user switches the locale switcher

### Requirement: Accessibility Primitives

Every icon-only `<button>` MUST have an `aria-label`. Every interactive element MUST expose a `focus-visible:ring-*` outline bound to the `--ui-focus` token. Every `aria-label` whose value is a user-facing label (NOT a technical hint) MUST be resolved through the `t()` function under the `ariaLabels.*` namespace — zero hardcoded Spanish or Portuguese `aria-label` strings MAY appear in component markup.
(Previously: `aria-label` values were hardcoded Spanish strings — assumed a single-language app.)

#### Scenario: Icon-only button labeled and focusable

- GIVEN a button whose only content is a Lucide icon
- WHEN the button renders
- THEN it carries an `aria-label` AND Tab-focus surfaces a ring outline
- AND the `aria-label` value is locale-aware (resolved via `t()`)

#### Scenario: Locale switch changes aria-labels

- GIVEN the app is rendered in `pt-BR`
- WHEN the user picks `es` from the LocaleSwitcher
- THEN every icon-only button's `aria-label` updates to its Spanish translation
- AND no component needs a manual re-render to pick up the new label
