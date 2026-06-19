# Design: Optimizer Strategy Pattern

## Technical Approach

Mirror the Strategy pattern from `src/utils/routing/` (`RouteProvider` → `RoutingService`). Each optimizer becomes a pluggable `Optimizer` implementation registered in a `OptimizerRegistry`. The `/api/optimize` endpoint calls `registry.runAll()` in parallel with `Promise.allSettled`, collects results, and extends `OptimizeResponse` with `results: OptimizerResult[]`. The frontend renders per-algorithm tabs in `ResultsPanel`. Legacy `days`/`totalDistance` fields survive as the best entry for back-compat.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| **Strategy pattern** | (A) Direct refactor of route.ts, (B) Per-algorithm classes behind `Optimizer` interface | (A) minimal diff but couples endpoint to each solver; (B) adds indirection but mirrors `routing/` pattern — adding a 4th algorithm is 1 file + 1 `register()` call | **(B)** — proven pattern from `routing/` refactor, self-documenting, extensible |
| **Geoapify distances** | (A) Use Route Planner distances, (B) Use our matrix for distances, Route Planner only for visit order | (A) simpler but distances differ across algorithms making results incomparable; (B) extra translation step but all algorithms report from the same `Record<string, number>` matrix | **(B)** — consistent scoring; Route Planner decides order, our matrix sets distance |
| **Geoapify cache** | (A) localStorage (client), (B) In-memory `Map` (server), (C) File-based (JSON) | (A) survives restarts but leaks to client; (B) simple, 24h TTL matches proposal, no persistence needed; (C) overkill for this use case | **(B)** — `Map<string, { result: OptimizerResult; ts: number }>`, evicted on read > 24h |
| **Frontend tabs** | (A) New tab component above ResultsPanel, (B) Tabs integrated into ResultsPanel as top-level selector | (A) minimal change to ResultsPanel; (B) natural UX — select algorithm, see its days below | **(B)** — tabs inside ResultsPanel; each tab reuses the existing `days` rendering unchanged |

## Data Flow

```
page.tsx                     /api/optimize
  │ POST {locations, config, matrix}     │
  │ ─────────────────────────────────→   │
  │                                      │ registry.runAll(params)
  │                                      │   ├─ CwOptimizer.optimize()
  │                                      │   ├─ Nsga2Optimizer.optimize()
  │                                      │   └─ GeoapifyOptimizer.optimize()
  │                                      │       ├─ cache.get(key) → hit? return
  │                                      │       └─ miss? POST api.geoapify.com/v1/routeplanner
  │                                      │           → parse order → split → calc dists from matrix
  │                                      │           → cache.set(key, result)
  │   { days, totalDistance, results[] } │
  │ ←─────────────────────────────────   │
  │
  │ ResultsPanel(days, results)
  │   ├─ Tab: "CW" → days={results[0].days}
  │   ├─ Tab: "NSGA-II" → days={results[1].days}
  │   └─ Tab: "Geoapify" → days={results[2].days}  (hidden if null)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/utils/optimizer/types.ts` | Create | `Optimizer` interface, `OptimizerResult`, `OptimizeParams` |
| `src/utils/optimizer/registry.ts` | Create | `OptimizerRegistry` with `register()` and `runAll()` using `Promise.allSettled` |
| `src/utils/optimizer/cache.ts` | Create | In-memory `Map` with 24h TTL, `sha1(sorted coords + config JSON)` key |
| `src/utils/optimizer/optimizers/cw.ts` | Create | `CwOptimizer` wrapping `optimizeRoutes`, normalizing to `OptimizerResult` |
| `src/utils/optimizer/optimizers/nsga2.ts` | Create | `Nsga2Optimizer` wrapping `runNSGA2`, picking `minDistance` as result |
| `src/utils/optimizer/optimizers/geoapify.ts` | Create | `GeoapifyRoutePlannerOptimizer` — translate config to Route Planner format, POST, parse |
| `src/utils/optimizer/optimizers/index.ts` | Create | `defaultOptimizers` array |
| `src/app/api/optimize/route.ts` | Modify | Replace inline CW+NSGA2 with `registry.runAll()`, extend response with `results[]` |
| `src/types/index.ts` | Modify | Add `OptimizerResult` to shared types, extend `OptimizeResponse` |
| `src/components/ResultsPanel.tsx` | Modify | Accept optional `results: OptimizerResult[]`, render algorithm tabs |
| `src/app/page.tsx` | Modify | Pass `results` to ResultsPanel, remove NSGA-II sidebar section |

## Interfaces / Contracts

```typescript
// src/utils/optimizer/types.ts
interface Optimizer {
  readonly name: string;    // stable id: "cw", "nsga2", "geoapify"
  readonly label: string;   // display: "CW", "NSGA-II", "Geoapify"
  optimize(params: OptimizeParams): Promise<OptimizerResult | null>;
}

interface OptimizerResult {
  algorithm: string;
  label: string;
  days: DayRoute[];
  totalDistance: number;
  totalDays: number;
  totalTime: number;
}

interface OptimizeParams {
  locations: Location[];
  home: Location;
  config: Config;
  matrix: Record<string, number>;
  strictMatrix?: DistanceMatrix;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `OptimizerRegistry.runAll()` partial-failure semantics | Mock optimizers returning success/null/throw; verify 200 with mixed slots |
| Unit | `optimizer/cache.ts` TTL eviction | Timer mock; insert, advance clock past 24h, verify miss |
| Integration | Geoapify translation (config → Route Planner format) | Snapshot test: given Config + Location[] → expected POST body |
| Integration | Full `/api/optimize` with all three optimizers | HTTP test; verify `results[]` length, legacy fields, per-algorithm tabs |
| E2E | UI tab switching | Browser test: three results → three tabs, Geoapify null → two tabs |

## Migration / Rollout

No migration required. Legacy `days`/`totalDistance` fields preserved as best entry; existing clients see no change. Rollback: revert `route.ts`, `page.tsx`, `ResultsPanel.tsx`, `rm -rf src/utils/optimizer/`.

## Open Questions

- [ ] Geoapify Route Planner cost per call vs free tier 3000 credits/day — confirm does not exhaust budget
- [ ] How to handle Geoapify Route Planner when our matrix has Infinity for some pairs (pre-filtered unreachable POIs)
