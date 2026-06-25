# AGENTS.md — vrp-solver (urban-system)

Multi-day Vehicle Routing Problem (VRP) solver. Upload spreadsheets of locations, configure constraints (hours/visits), and get optimized multi-day routes via two parallel solvers.

## Quick start

```bash
npm run dev        # Next.js dev server (http://localhost:3000)
npm run build      # next build
npm run lint       # next lint (ESLint via eslint-config-next)
npm run type-check # tsc --noEmit (TypeScript strict)
```

## Architecture

- **SPA in Next.js App Router** — single `src/app/page.tsx` (client component), server-side API routes for optimization.
- **5-phase wizard**: Upload → Column Mapping → Review/Edit → Config → Results. State lives in `page.tsx`; no router-based pages.
- **Path alias**: `@/*` → `./src/*` (tsconfig paths).

### Directory layout

```
src/
  app/                           # Next.js App Router
    page.tsx                     # Main SPA (1155 lines, "use client")
    layout.tsx                   # Root layout (Leaflet CSS import)
    api/
      optimize/route.ts          # POST — runs both solvers, returns best
      optimize/config/route.ts   # GET — hasGeoapify, maxLocations
      routing/route.ts           # POST — route geometry (Geoapify > OSRM > Haversine)
  components/                    # React components
    MapView.tsx                  # Leaflet map (dynamic import, ssr: false)
    map/                         # Leaflet hooks: useLeafletMap, useLeafletMarkers, useLeafletPolylines
    RouteEditor.tsx              # Drag-and-drop route editing with undo/redo
    FileUpload.tsx, ColumnMapper.tsx, DataEditor.tsx, ConfigPanel.tsx, ResultsPanel.tsx
  utils/                         # Client + server logic
    routerOptimizer.ts           # Route-First + NN reorder + GA refinement
    nsga2.ts                     # NSGA-II (multi-objective, Pareto front)
    geneticOptimizer.ts          # GA post-refinement
    geoapifyMatrix.ts            # Geoapify Route Matrix API (batched, 1000 elements/req)
    clientRouting.ts             # Client-side OSRM matrix builder + route geometry fetcher
    routerOptimizer.ts           # Main deterministic optimizer (Giant tour + split + NN reorder)
    parser.ts                    # TODO: add file description
    unreachableFilter.ts         # Pre-filters POIs with no real road connection
    googleRouting.ts             # Dead code — Google Routes API not wired
    constants.ts                 # REAL_VS_ESTIMATED_KM (0.1), TINY_DISTANCE_KM (0.05)
  types/index.ts                 # All shared types
  lib/utils.ts                   # cn(), formatDistance(), formatDuration(), getRouteColor()
```

## Solvers

Both run server-side on every `/api/optimize` call. Best result is returned.

1. **Route-First + GA** (`routerOptimizer.ts` → `geneticOptimizer.ts`): giant tour → constraint-split → NN reorder → GA refinement (pop 60, 100 generations).
2. **NSGA-II** (`nsga2.ts`): multi-objective (minimize distance + max day hours), 30s timeout, pop 80, 100 generations.

## Distance matrix tiers

Priority: **Geoapify** (real roads, API key) → **OSRM** (free, public `router.project-osrm.org`, 5s timeout) → **Haversine** (straight-line fallback).

- Matrix cached in `localStorage` under `vrp_matrix_<hash>`. Cache key includes home coordinates.
- Geoapify batch size: max 15 points per chunk (961 elements/req, free tier 3000 credits/day).
- OSRM concurrency: 4 parallel requests (page.tsx) or 5 (clientRouting.ts).
- Sub-50m pairs skip OSRM (threshold: `TINY_DISTANCE_KM` in `constants.ts`).

## Map

- **Leaflet** (migrated from MapLibre — PRs 1-3). Dynamic import with `ssr: false` (window is not defined during SSR).
- Map component: `MapView.tsx` with three hooks: `useLeafletMap`, `useLeafletMarkers`, `useLeafletPolylines`.
- Route geometry fetched via `/api/routing` (Geoapify → OSRM → straight-line).
- Map must have explicit height (`.map-container` in globals.css).

## Key gotchas

- **No tests**. No test runner. `next lint` and `tsc --noEmit` are the only quality gates.
- **Geoapify key**: set `GEOAPIFY_API_KEY` in `.env.local`. Without it, KOsrm/Haversine are used.
- **`useStrictMatrix`** is a feature flag (PR 6, in progress). When `true`, the API builds a `DistanceMatrix` with per-pair `MatrixEntry` (source metadata). Default `false` — behavior is bit-identical to pre-PR-6.
- **`googleRouting.ts`** is dead code — the Google Routes API adapter is not wired into the API route.
- **Matrix cache** discards on size mismatch or home coordinate change (>300m). Cache keys are 36-base hashes of sorted coordinate strings.
- **OSRM public API** has rate limits. The app uses 4-5 concurrent requests with 3-5s timeouts. Home→POI pairs are fetched separately (post-cache-load) when home changes.
- **Conventional commits**. Chained PR workflow for the active "real-roads-only" change.
- **`sdd/` directory** tracks the in-progress "real-roads-only" change. `openspec/` has specs, design, and tasks for completed and in-progress changes.
- **Route editing**: `RouteEditor` supports undo/redo (cap 20), drag-drop between days, and map-based POI relocation via floating action bar.

## Workflow

Active change tracked via SDD (Spec-Driven Development):

- `openspec/changes/` — specs, designs, tasks
- `sdd/` — exploration artifacts
- Use `sdd-continue` via OpenCode's native dispatcher when available

[openspec/config.yaml](./openspec/config.yaml) has the full project context and SDD conventions.
