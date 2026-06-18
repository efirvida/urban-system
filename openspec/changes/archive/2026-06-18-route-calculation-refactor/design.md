# Design: Route Calculation Refactor

## Technical Approach

Replace two parallel routing stacks (frontend OSRM per-pair + backend Geoapify matrix override) with a single **Strategy Pattern** plugin system. A `RoutingService` orchestrates pluggable `RouteProvider` implementations tried in priority order (Geoapify → OSRM) per pair. No Haversine fallback — unreachable pairs get `Infinity`. Backend `/api/optimize` receives the completed frontend matrix and passes it through unchanged.

## Architecture Decisions

| Decision | Option | Tradeoff | Choice |
|----------|--------|----------|--------|
| Provider plugin model | Strategy Pattern via `RouteProvider` interface | **Hard requirement from user**: new APIs must slot in without touching core logic. | `RouteProvider` interface + priority-ordered array in `RoutingService`. |
| Geoapify API key protection | Backend proxy via `POST /api/routing` | Direct frontend call would expose `GEOAPIFY_API_KEY`. Backend proxy already exists and returns per-leg distance. | Geoapify provider calls `/api/routing` with 2 stops; key stays server-side. |
| OSRM call origin | Public API from frontend | No API key needed; backend proxy adds server cost. Direct call also parallelizes with Geoapify backend call. | OSRM provider calls `router.project-osrm.org` directly from frontend. |
| Per-leg caching strategy | Extend existing `routeLegKey` localStorage pattern | Current cache stores only geometry (`[number, number][]`). Must now store `{distance, geometry, source, timestamp}`. | Cache layer in `cache.ts` — backwards-compatible key format, richer value shape. LRU eviction via `localStorage` size guard. |
| Set size guard | Cap entries at 5000 via size check | `localStorage` has ~5MB limit per origin. Large matrices (50+ POIs → 1275+ pairs) could fill it. | Evict oldest entries when >5000 keys stored. |

## Data Flow

```
page.tsx optimize()
  └─> RoutingService.buildDistanceMatrix(points)
        └─ for each pair (i,j):
             ├─ cache.get(key) → hit → cached distance
             └─ miss → service.route(a, b)
                  ├─ GeoapifyProvider.route(a,b)
                  │    └─ POST /api/routing {stops:[a,b]}  ──(backend)──> Geoapify API
                  │         if response.source === "geoapify" → return {distance, geometry, duration}
                  ├─ OSRMProvider.route(a,b)
                  │    └─ GET router.project-osrm.org/route/v1/driving/...
                  │         if ok → return {distance, geometry, duration}
                  └─ null → pair unreachable (Infinity)
             └─ cache.set(key, result)

/api/optimize  ←  { locations, config, distanceMatrix: Record<string,number> }
  (no Geoapify override — passes matrix to optimizer unchanged)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/utils/routing/types.ts` | Create | `RouteProvider`, `RouteLegResult`, `CachedLeg` types |
| `src/utils/routing/cache.ts` | Create | `getCachedLeg()` / `setCachedLeg()` / key builder — per-leg localStorage with `{distance, geometry, source, timestamp}` |
| `src/utils/routing/service.ts` | Create | `RoutingService` — holds sorted providers, `route(a,b)` chain-of-responsibility, `buildDistanceMatrix(points)` |
| `src/utils/routing/providers/geoapify.ts` | Create | Calls `POST /api/routing` with 2 stops, returns result iff `source === "geoapify"` |
| `src/utils/routing/providers/osrm.ts` | Create | Calls `router.project-osrm.org` directly, 5s timeout |
| `src/utils/routing/providers/index.ts` | Create | Exports `defaultProviders: RouteProvider[]` (Geoapify priority 0, OSRM priority 1) |
| `src/utils/clientRouting.ts` | Rewrite | `buildDistanceMatrices()` delegates to `RoutingService`; `fetchAllRouteGeometries()` reads from routing cache instead of separate geometry-only cache; drop `distCache`, `osrmPair`, Haversine code |
| `src/app/api/optimize/route.ts` | Modify | Remove `geoapifyMatrix` import, `buildGeoapifyMatrix()` call, `geoapifyCache`, `geoapifyTried`, Haversine fill, `buildDistanceMatrix()` helper; accept frontend matrix as-is |
| `src/app/page.tsx` | Modify | Replace inline OSRM matrix loops (lines 460-632) with `RoutingService.buildDistanceMatrix()` call; drop Geoapify merge logic (lines 666-691) |
| `src/utils/geoapifyMatrix.ts` | Delete | Replaced by Geoapify provider + backend proxy |
| `src/utils/constants.ts` | Modify | Remove `TINY_DISTANCE_KM` if no remaining references after refactor |

## Interfaces / Contracts

```typescript
interface RouteProvider {
  readonly name: string;
  readonly priority: number;       // lower = tried first
  route(a: Point, b: Point): Promise<RouteLegResult | null>;
}

interface RouteLegResult {
  distanceKm: number;
  durationSeconds: number;
  geometry: [number, number][];
  source: string;                  // provider name (e.g. "geoapify")
}

interface CachedLeg extends RouteLegResult {
  timestamp: number;               // for TTL / LRU eviction
}
```

**Provider contract**: `route()` returns `null` when the provider cannot find a real road. Never throws — errors are caught internally, returning `null`. The `RoutingService` tries next provider; if all return `null`, the pair is unreachable.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Build | `tsc --noEmit` | TypeScript strict — catches interface violations, missing imports |
| Lint | `next lint` | Detects unused vars, dead code after deletion |
| Manual | Full matrix → optimize flow | Run app with real data, verify optimizer output matches pre-refactor |

## Migration / Rollout

No migration required. `localStorage` keys are backwards-compatible (existing `route_*` keys will be stale and overwritten with the enriched format on next run). Rollback: `git revert` + restore `geoapifyMatrix.ts` from history.

## Open Questions

- [ ] Should the cache layer use IndexedDB instead of localStorage for matrices > 1000 pairs? (Current max: 1275 pairs for 50 POIs + home; at ~200 bytes per entry = ~255KB — well within localStorage limits.)
