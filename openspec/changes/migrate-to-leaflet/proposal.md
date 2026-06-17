# Proposal: Migrate to Leaflet

## Intent

MapLibre GL 4.5 click-handler defects broke the POI click → sidebar selection flow in three consecutive sessions: popup `stopPropagation` conflicts, capture-phase listener workarounds, silent marker click failures. Leaflet 1.9+ uses a direct DOM event model that makes these issues structurally impossible. Pure library swap — no behavior change.

## Scope

### In Scope
- Rewrite `src/components/MapView.tsx` (~660 lines)
- Rewrite `src/components/RouteMap.tsx` (~162 lines)
- Rewrite `src/components/LocationMapEditor.tsx` (~181 lines)
- Add `src/hooks/useLeafletMap.ts`, `useLeafletMarkers.ts`, `useLeafletPolylines.ts`
- Swap CSS import in `src/app/layout.tsx`
- Swap deps: drop `maplibre-gl@^4.5.0`; add `leaflet@^1.9.4` + `@types/leaflet@^1.9.12`

### Out of Scope
- `react-leaflet` (project uses imperative refs; match style)
- UX, color, or feature changes
- `route-editing` spec changes
- New map providers or styles

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None. Pure library swap. The `route-editing` "Map-to-Sidebar POI Selection" requirement continues to hold; only the implementation changes.

## Approach

Rewrite each component with Leaflet DOM events. `marker.on('click', ...)` attaches directly — no capture-phase tricks. Routes become `L.polyline` per day with a dark glow polyline underneath. Dashed Haversine (estimated) routes use `dashArray`. Hooks split concerns:

- `useLeafletMap` — `L.Map` lifecycle
- `useLeafletMarkers` — diffing
- `useLeafletPolylines` — per-day glow+route + dash

Preserved 1:1: OSM tiles, draggable home, numbered route markers, POI click → `onPOIClick` + popup, route hide/show, day highlight, fitBounds, placement crosshair, pointer cursor, dashed estimated lines, glow outline, real-roads badge.

## Affected Areas

- `src/components/MapView.tsx` — rewritten
- `src/components/RouteMap.tsx` — rewritten
- `src/components/LocationMapEditor.tsx` — rewritten
- `src/hooks/useLeaflet*.ts` — new
- `src/app/layout.tsx` — modified (CSS)
- `package.json` — modified (deps)

## Risks & Mitigations

- **TS strict** (Low) — `@types/leaflet` covers `L.Map`/`L.Marker`/`L.Polyline`
- **OSM tile policy** (Low) — unchanged from current MapLibre usage
- **Visual regression** (Med) — side-by-side smoke: home drag, POI click, route hide/show, highlight, fitBounds
- **Default marker icon missing** (Low) — pass `iconUrl`/`iconRetinaUrl`/`shadowUrl` or set `imagePath`
- **Bundle size** (Low) — Leaflet ~40KB gz vs MapLibre ~200KB gz, net reduction

## Rollback Plan

Single atomic commit. `git revert` restores the MapLibre implementation. No data, DB, or API contract change.

## Dependencies

- `leaflet@^1.9.4`
- `@types/leaflet@^1.9.12` (dev)
- Remove: `maplibre-gl@^4.5.0`

## Success Criteria

- `tsc --noEmit` + `next build` pass (strict TS)
- All three components mount, render OSM tiles, accept gestures
- POI click fires `onPOIClick` + popup, no workarounds
- Home marker drags; `onDragHome` fires on `dragend`
- Placement mode: crosshair, map click places home
- Numbered markers per day; hide/show toggle works
- Polylines with per-day color + glow + dashed estimated
- `fitBounds` shows all points after data change
- `maplibre-gl` gone; `leaflet` + `@types/leaflet` present
- `layout.tsx` imports `leaflet/dist/leaflet.css`
