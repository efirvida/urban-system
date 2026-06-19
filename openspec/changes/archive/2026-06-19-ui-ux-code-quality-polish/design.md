# Design: UI/UX & Code Quality Polish

## Technical Approach

Apply an additive visual foundation (CSS custom properties, icon system) and targeted code-quality fixes across 12 files. Zero changes to optimizers, routing, parser, or state logic. All quality gates (`tsc --noEmit`, `next lint`, `next build`) remain passing at every commit.

## Architecture Decisions

### Decision 1: CSS Custom Properties over `theme.extend` for all tokens

| Option | Tradeoff | Decision |
|--------|----------|----------|
| CSS `--ui-*` in `:root` | Loose coupling; any Tailwind class can reference via `var()` | **Chosen** |
| `theme.extend` only | Requires Tailwind recompilation; locked to Tailwind runtime | Rejected |
| Both | Double maintenance surface | Rejected |

**Rationale**: Properties like `--ui-shadow-sm` are consumed in `@apply` directives inside `@layer components` and future inline styles (toast animation). `theme.extend` is used only for radius tokens (`--ui-radius-*`) mapped to `borderRadius` so Tailwind utilities like `rounded-ui-md` work without `var()`.

### Decision 2: CSS-only toast animation (no framer-motion)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| CSS `@keyframes` + `animation` | 8 lines of CSS; zero new deps | **Chosen** |
| `motion` from framer-motion | 43 KB gzipped dep; overkill for one animation | Rejected |

**Rationale**: `framer-motion` is not in `package.json`. A slide-down + fade-in keyframe via `animate-slide-down` class keeps the bundle unchanged and is trivially testable with a manual smoke test.

### Decision 3: `WizardSteps` as leaf component with props-only

**Choice**: `<WizardSteps phases={PHASES} currentIdx={currentIdx} />`  
**Rationale**: page.tsx is 1246 lines. Extracting the steps bar removes ~20 lines of JSX without pulling any state, hooks, or context. The component is a pure function of props — no regression surface.

## Emoji → Lucide Mapping

| Emoji | Location | Lucide Icon | Size |
|-------|----------|-------------|------|
| 📂 | PHASES[upload] | `FolderOpen` | 14 |
| 📋 | PHASES[mapping] | `ClipboardList` | 14 |
| ✏️ | PHASES[review] | `Pencil` | 14 |
| ⚙️ | PHASES[config] | `Settings` | 14 |
| ✅ | PHASES[results] | `CheckCheck` | 14 |
| 🚚 | Sidebar title | `Truck` | 16 |
| 🚀 | OptimizeButton | `Rocket` | 16 |
| ⏰ | ConfigPanel hours | `Clock` | 14 |
| 📍 | ConfigPanel visits / ColumnMapper lat/lng | `MapPin` | 14 |
| ⚡ | ConfigPanel hours+visits | `Zap` | 14 |
| 🏠 | ConfigPanel home / MapView | `Home` | 14 |
| 🎯 | ConfigPanel placing mode | `Crosshair` | 14 |
| 🏷️ | ColumnMapper nameColumn | `Tag` | 14 |
| 🔍 | ColumnMapper banner | `Search` | 14 |
| 📐 | ColumnMapper DMS banner | `Ruler` | 14 |
| ✓ | ColumnMapper / DataEditor validations | `Check` | 12 |
| ✗ | ColumnMapper / DataEditor invalid | `X` | 12 |
| ❌ | OptimizeProgress error | `X` | 24 |
| 🔄 | OptimizeProgress calculating | `RefreshCw` | 14 |
| 👁 | page.tsx "Ver todas" button | `Eye` | 14 |
| 🆕 | page.tsx "Nueva optimización" | `PlusCircle` | 14 |
| 🚗 | ResultsPanel routingLabel | `Car` | 14 |
| 🧬 | page.tsx algorithm note | `Dna` | 14 |

## Data Flow

```
globals.css (:root) ──→ Tailwind @layer components ──→ cn() in components
                                              ──→ inline var() references

WizardSteps (NEW) ←── PHASES + currentIdx from page.tsx
    │                    (no state, no context)
    └── renders 5-step pill bar with Lucide icons
```

No cross-component data flow changes. Each migration is a 1:1 replacement within a single component.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/app/globals.css` | Modify | Add `--ui-*` tokens in `:root`; add `@keyframes slideDown` |
| `tailwind.config.ts` | Modify | Extend `borderRadius` with `--ui-radius-*` |
| `src/components/WizardSteps.tsx` | **Create** | Leaf component: `phases` + `currentIdx` → pill bar |
| `src/app/page.tsx` | Modify | Replace emojis with Lucide; extract stepsNode → `<WizardSteps>`; fix `useConsensusFeature` → module constant; type guards for `DayRoute[]` and `_meta`; remove eslint-disable; toast animation |
| `src/components/OptimizeButton.tsx` | Modify | 🚀 → `Rocket` |
| `src/components/ConfigPanel.tsx` | Modify | ⏰📍⚡🏠🎯✓ → Lucide; stepper `−`/`+` buttons → Lucide `Minus`/`Plus` |
| `src/components/DataEditor.tsx` | Modify | ✓/✗ → Lucide; unselected rows: `opacity-40` → `bg-gray-50/50` + full opacity text |
| `src/components/ColumnMapper.tsx` | Modify | All emoji fields/validations → Lucide |
| `src/components/OptimizeProgress.tsx` | Modify | ❌✅🔄 → Lucide |
| `src/components/ResultsPanel.tsx` | Modify | Template literal → `cn()` (line 276); 🚗 → `Car` |
| `src/types/index.ts` | Modify | Add `isDayRouteArray()` and `isOptimizeMeta()` type guards |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Build | No import/type errors | `tsc --noEmit`, `next lint`, `next build` |
| Visual | All 5 wizard phases render | Manual smoke: navigate upload → results |
| Visual | Toast appears, animates, auto-dismisses | Trigger error path (empty locations + optimize) |
| Visual | DataEditor unselected rows readable | Load file with 10+ rows, verify checkbox visible and text legible |
| A11y | Icon-only buttons have `aria-label` | Audit `btn` + Lucide children; add labels where missing |

## Migration / Rollout

No migration required. All changes are CSS + component-internal. Revert is `git revert` of the merge commit.

## Open Questions

- [ ] ConfigPanel stepper `−`/`+`: Lucide `Minus`/`Plus` or keep text? (Text `−`/`+` is unambiguous at large sizes; Lucide is cleaner but less obvious at 18px. Delegate decision to apply phase based on visual test.)
- [ ] 🧬 emoji (page.tsx:1007) "Se ejecutan ambos algoritmos": replace with `Dna` icon or keep as plain text? The text is informational — icon may add noise. Recommend: remove emoji, keep text only.
