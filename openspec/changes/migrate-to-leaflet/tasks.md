# Tasks: Migrate to Leaflet

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~820 (660 rewrite + 162 + 181 + ~240 new hooks/icons + CSS) |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation → PR 2 MapView → PR 3 RouteMap+Editor+cleanup |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation: deps, CSS, hooks, divIcon factory | PR 1 | Standalone; builds on its own; verifiable via tsc |
| 2 | Rewrite MapView.tsx using hooks | PR 2 | Depends on PR 1; largest diff (~660 → ~250) |
| 3 | Rewrite RouteMap + Editor, uninstall maplibre-gl | PR 3 | Depends on PR 2; completes the swap |

## Phase 1: Foundation

- [x] 1.1 Install `leaflet@^1.9.4` + `@types/leaflet@^1.9.12` (dev)
- [x] 1.2 Create `src/components/map/` directory
- [x] 1.3 Swap CSS in `src/app/layout.tsx`: `maplibre-gl.css` → `leaflet/dist/leaflet.css`
- [x] 1.4 Create `leafletIcons.ts` divIcon factories (home, numbered route, POI pin) styled with Tailwind classes via `innerHTML`
- [x] 1.5 Create `useLeafletMap.ts`: `L.Map` init on containerRef, cleanup on unmount, placement-mode crosshair + map click handler
- [x] 1.6 Create `useLeafletMarkers.ts`: home/route/POI marker lifecycle with id-based diffing; `marker.on('click', handler)` direct binding
- [x] 1.7 Create `useLeafletPolylines.ts`: `L.layerGroup` per day, two `L.polyline` per day (colored route + wider darker glow), `dashArray` for estimated, visibility + highlight toggle
- [x] 1.8 Verify `tsc --noEmit` passes after PR 1 (hooks compile cleanly in isolation)

## Phase 2: Rewrite MapView.tsx

- [x] 2.1 Strip MapLibre import + state; replace with hook composition (~250 lines orchestration)
- [x] 2.2 Preserve `MapViewData` props interface and event callbacks (`onPOIClick`, `onPlaceHome`, `onDragHome`, etc.)
- [x] 2.3 POI pins: `marker.on('click', handler)` + `marker.bindPopup(html)` (no capture-phase workarounds)
- [x] 2.4 Home marker: draggable + `dragend` → `onDragHome(coords)`
- [x] 2.5 Wire placement mode: crosshair cursor + map click places home
- [x] 2.6 Wire `fitBounds` on data change; per-day hide/show + highlight
- [x] 2.7 `tsc --noEmit` + `next build` pass

## Phase 3: Rewrite RouteMap + LocationMapEditor

- [ ] 3.1 Rewrite `RouteMap.tsx` (~80 lines): read-only results display using hooks; same props
- [ ] 3.2 Rewrite `LocationMapEditor.tsx` (~110 lines): draggable markers in review phase using hooks; preserve selection
- [ ] 3.3 `tsc --noEmit` + `next build` pass

## Phase 4: Cleanup & Verification

- [ ] 4.1 `npm uninstall maplibre-gl` (+ `@types/maplibre-gl` if present)
- [ ] 4.2 Smoke: upload → phases → results → edit mode → click POI → drag home → toggle day
- [ ] 4.3 Visual: home drag, POI click + popup, route hide/show, highlight, fitBounds
- [ ] 4.4 `git commit` as single atomic PR — or chained per `Chain strategy` decision
