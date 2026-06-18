# Design: Route Geometry Cache

## Technical Approach

Wrap each `/api/routing` call in `fetchAllRouteGeometries()` with a cache-first check. On hit: return stored encoded polyline (decoded to `[number,number][]`). On miss: fetch, encode with `@mapbox/polyline` (precision 5), persist, return. The cache is a standalone module — zero coupling with the per-leg routing cache in `cache.ts`.

## Architecture Decisions

### Decision: Cache interface abstraction

**Choice**: `RouteGeometryCache` interface with `get(key): Promise<[number,number][] | null>` and `set(key, geometry, source): Promise<void>`.

**Alternatives**: (1) Direct function calls — tight coupling, no swap path. (2) Inline caching in `clientRouting.ts` — muddies the facade.

**Rationale**: The proposal calls for "swappable." An interface lets future implementations (IndexedDB, server-side) drop in without touching consumers. Async in signature matches real storage APIs and the fetch pattern.

### Decision: Encoded Polyline storage

**Choice**: Store as `{ encoded: string, source: string, timestamp: number }` using `@mapbox/polyline` at precision 5 (≈1cm).

**Alternatives**: (1) Raw `[number,number][]` JSON — 3–5× larger per entry. (2) Precision 6 — double storage for sub-cm accuracy nobody sees on a map.

**Rationale**: An 80-coord route is ~400B raw JSON vs ~120B encoded. At 200 entries: ~80KB vs ~24KB. Precision 5 exceeds Leaflet zoom ~18 rendering needs.

### Decision: Key derivation

**Choice**: Sorted `"lat,lng"` strings at precision 5, joined with `|`, hashed via djb2 (same as `locationsHash` in `page.tsx`), prefixed with `geo_`.

**Alternatives**: (1) Day number in key — breaks when route reordering changes day assignments. (2) Unsorted stops — produces different keys for identical stop sets.

**Rationale**: Sorted + precision-5 ensures the same stops always hit the same entry regardless of day number or visit order. The `locationsHash` pattern is proven in this codebase.

## Data Flow

```
fetchAllRouteGeometries(days)
  │
  ├─ For each day:
  │    key = routeGeometryKey([stop1, stop2, ..., stopN])
  │    cached ← geometryCache.get(key)
  │    │
  │    ├─ HIT: return decoded polyline + cached.source
  │    └─ MISS:
  │         POST /api/routing { stops }
  │         geometryCache.set(key, coords, source)
  │         return coords + source
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/utils/routing/geometryCache.ts` | Create | `RouteGeometryCache` interface, `LocalStorageGeometryCache` class, `routeGeometryKey()` helper, cap 200, LRU eviction |
| `src/utils/clientRouting.ts` | Modify | `fetchAllRouteGeometries()` imports and consults `geometryCache` before API calls |
| `package.json` | Modify | Add `@mapbox/polyline` dependency |

## Interfaces / Contracts

```typescript
// geometryCache.ts
export interface RouteGeometryCache {
  get(key: string): Promise<[number, number][] | null>;
  set(key: string, geometry: [number, number][], source: RouteSource): Promise<void>;
  clear(): Promise<void>; // optional for debugging
}

export function routeGeometryKey(stops: Point[]): string;
```

Key format: `geo_<djb2-hash-of-sorted-normalized-coords>`. Stops are normalized to `toFixed(5)`, sorted alphabetically, joined with `|`, then hashed (djb2 → base-36). Matches the `locationsHash` pattern in `page.tsx` but at precision 5.

## Eviction Strategy

Timestamp-based LRU matching `cache.ts` pattern. On `set()`: count `geo_`-prefixed keys. If > 200, collect all entries, parse timestamps, sort ascending, drop oldest 40 (20%). Sweep is O(n) on `localStorage.length` but only fires at threshold crossings — steady-state cost is zero.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `routeGeometryKey()` determinism | Manual verification: same stops → same key, different precision → different key |
| Unit | Encode/decode round-trip | Verify `polyline.decode(polyline.encode(coords, 5))` ≈ input within 5-decimal tolerance |
| Integration | Cache miss → fetch → store | Manual: clear cache, view results, verify localStorage entries + no re-fetch on re-view |
| Integration | Eviction under cap | Manual: seed 210 entries, verify oldest 40% dropped |

> No test runner exists — manual verification per project convention.

## Migration / Rollout

No migration required. New cache is additive — existing `/api/routing` calls remain as fallback. Rollback: remove the get/set calls in `fetchAllRouteGeometries()`, delete `geometryCache.ts`, uninstall `@mapbox/polyline`. Orphaned `geo_*` localStorage keys are inert.

## Open Questions

- None
