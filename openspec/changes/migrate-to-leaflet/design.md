# Design: Migrate to Leaflet

## Technical Approach

Replace MapLibre GL 4.5 with Leaflet 1.9+ as a pure library swap. Split the monolithic 660-line `MapView.tsx` into an orchestration component (~250 lines) and three imperative hooks: `useLeafletMap` (map lifecycle), `useLeafletMarkers` (marker diffing), `useLeafletPolylines` (per-day glow+route). Leaflet's direct DOM event model eliminates capture-phase workarounds. No react-leaflet — match existing `useRef` + `useEffect` style. All features preserved 1:1.

## Component Tree

```
MapView.tsx (~250 loc)
 ├── useLeafletMap       → L.map(), controls, cleanup, ResizeObserver, cursor
 ├── useLeafletMarkers   → L.divIcon markers: home (SVG), numbered stops, location pins
 └── useLeafletPolylines → L.layerGroup per day: L.polyline (route) + L.polyline (glow)

RouteMap.tsx (~100 loc)         — uses useLeafletMap + useLeafletMarkers
LocationMapEditor.tsx (~130 loc) — uses useLeafletMap + useLeafletMarkers + drag
```

## Architecture Decisions

| Decision | Option | Tradeoff | Choice |
|----------|--------|----------|--------|
| Component structure | A) Monolithic MapView (660 loc) vs B) MapView + 3 hooks | B splits concerns, keeps orchestration under 300 loc, hooks testable independently | **B** |
| Icon strategy | L.icon (static images) vs L.divIcon (HTML/SVG) | divIcon matches existing inline SVG pattern for home/numbers/pins exactly, no asset pipeline | **divIcon** |
| Route rendering | L.polyline per day + glow polyline, grouped with L.layerGroup | LayerGroup gives batch visibility toggle; two polylines per day (colored route + dark wider glow) is simpler than MapLibre's paint-property gymnastics | **L.polyline × 2 + L.layerGroup** |
| Click handling | Capture-phase DOM listeners vs `marker.on('click', …)` | Leaflet events bubble correctly — no stopPropagation issues, no capture tricks | **Direct .on('click')** |
| Popup binding | `marker.bindPopup(html)` | Leaflet popups auto-toggle, no conflict with click handler — POI click fires `onPOIClick` + shows popup | **bindPopup** |
| Highlight mechanism | `setStyle({ weight, opacity })` per polyline via layerGroup iteration | Simpler than MapLibre's `setPaintProperty` per layer ID string | **setStyle iteration** |
| Map lifecycle | `useEffect` init + cleanup return, `useRef` for instance | Matches existing pattern, no class components | **useEffect + useRef** |
| ResizeObserver | `ResizeObserver` on container → `map.invalidateSize()` | Leaflet needs explicit invalidation on container resize; debounce in hook | **ResizeObserver** |

## Data Flow

```
page.tsx (mapData: MapViewData)
    │
    ▼
MapView.tsx ──► useLeafletMap     → L.map, controls, ResizeObserver, cleanup
            ──► useLeafletMarkers → diffs home/stop/pin markers, click, popup
            ──► useLeafletPolylines → per-day L.layerGroup(route+glow), dash, toggle
```

## Hook Interfaces

```ts
// useLeafletMap.ts
function useLeafletMap(
  containerRef: RefObject<HTMLDivElement>,
  opts?: { center?: L.LatLngTuple; zoom?: number; onMapClick?: (latlng: L.LatLng) => void }
): { map: L.Map | null }

// useLeafletMarkers.ts
interface MarkerItem {
  id: string; lat: number; lng: number;
  type: 'home' | 'route-stop' | 'location-pin';
  label?: string; color?: string; popupHtml?: string;
  draggable?: boolean; onDragEnd?: (lat: number, lng: number) => void;
  poiData?: { lat: number; lng: number; day: number; name: string };
}
interface MarkerOptions {
  onPOIClick?: (lat: number, lng: number, day: number, name: string) => void;
  selectedPOI?: { lat: number; lng: number; day: number; name: string } | null;
}
function useLeafletMarkers(map: L.Map | null, items: MarkerItem[], opts?: MarkerOptions): void

// useLeafletPolylines.ts
function useLeafletPolylines(
  map: L.Map | null,
  routes: DayRoute[],
  home?: { lat: number; lng: number } | null,
  opts?: {
    hiddenDays?: Set<number>; highlightDay?: number | null;
    routeGeometry?: Map<number, [number, number][]>;
    routeSource?: Map<number, RouteSource>;
  }
): void
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useLeafletMap.ts` | Create | L.Map init, cleanup, controls, ResizeObserver, cursor, map-click handler |
| `src/hooks/useLeafletMarkers.ts` | Create | Marker diffing with L.divIcon: home, route stops, location pins; click/popup binding; selectedPOI highlight |
| `src/hooks/useLeafletPolylines.ts` | Create | Per-day L.layerGroup with route + glow L.polyline; dashArray; visibility toggle; highlight setStyle |
| `src/components/MapView.tsx` | Rewrite | ~250 loc orchestration: composes hooks, renders container + overlay badges |
| `src/components/RouteMap.tsx` | Rewrite | ~100 loc: uses useLeafletMap + useLeafletMarkers, OpenFreeMap tiles |
| `src/components/LocationMapEditor.tsx` | Rewrite | ~130 loc: uses useLeafletMap + draggable markers via useLeafletMarkers |
| `src/app/layout.tsx` | Modify | Replace `maplibre-gl/dist/maplibre-gl.css` → `leaflet/dist/leaflet.css` |
| `package.json` | Modify | `maplibre-gl@^4.5.0` → `leaflet@^1.9.4`; add `@types/leaflet@^1.9.12` (dev) |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Hook logic (marker diffing, polyline creation) | Mock L map, verify method calls |
| Integration | MapView mounts, renders OSM tiles, markers respond to click | `@testing-library/react` + jsdom |
| Visual | Home drag, POI click → popup, route hide/show, highlight, fitBounds | Manual side-by-side smoke against MapLibre version |

## Migration / Rollout

No migration required. Single atomic commit. `git revert` restores MapLibre. No data, DB, or API contract changes.

## Open Questions

- None — all six architecture decisions resolved above. The proposal's success criteria are measurable and achievable with this design.
