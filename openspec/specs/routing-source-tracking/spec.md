# Routing Source Tracking Specification

## Purpose

Every distance pair and every polyline segment MUST carry a source tag (`real` / `estimated` / `unreachable`) so the UI, the optimizer, and the user can distinguish real road geometry from Haversine fallbacks.

## Requirements

### Requirement: Per-pair routing-source visibility

Every pair MUST be tagged `real` (OSRM/Geoapify), `estimated` (Haversine, including tiny < 50 m), or `unreachable`. The response MUST expose aggregate counts under `_meta`; the map MUST render real vs estimated legs differently.

#### Scenario: Mixed matrix (happy path)

- GIVEN 80% real, 15% estimated, 5% unreachable pairs
- WHEN the response is built
- THEN counts surface under `_meta`; the map shows solid polylines for real and dashed for estimated

#### Scenario: One estimated leg

- GIVEN a route leg with no real road geometry
- WHEN the map renders
- THEN that segment is dashed (`dashArray: [2, 3]` for the route layer and `[1, 4]` for the glow layer)

#### Scenario: All legs real

- GIVEN every leg is OSRM or Geoapify
- WHEN rendered
- THEN `estimated` count is 0 and every polyline is solid

#### Scenario: Tiny pair < 50 m

- GIVEN two POIs 30 m apart
- WHEN measured
- THEN Haversine is used and the pair is tagged `estimated` (not an error)

#### Scenario: Geoapify credit exhaustion

- GIVEN Geoapify budget hit and OSRM has the data
- WHEN built
- THEN OSRM pairs are tagged `real`; Haversine-only pairs are tagged `estimated`

### Requirement: Map polyline styling for estimated routes

`useLeafletPolylines` MUST accept a per-day `routeSource` map. When the source for a day is `"haversine"`, the source is undefined, or the geometry is a straight-line fallback, the polyline for that day MUST render with `dashArray: [2, 3]` (route layer) and `[1, 4]` (glow layer). When the source is `"osrm"` or `"geoapify"`, the polyline MUST render solid (no `dashArray`).

#### Scenario: Day with real OSRM geometry

- GIVEN `routeSource.get(day) === "osrm"`
- WHEN `useLeafletPolylines` paints the day
- THEN the route layer has no `dashArray`

#### Scenario: Day with Haversine fallback geometry

- GIVEN no real geometry OR `routeSource.get(day) === "haversine"`
- WHEN `useLeafletPolylines` paints the day
- THEN the route layer has `dashArray: [2, 3]` and the glow has `dashArray: [1, 4]`

### Constraints

- Source tag is per pair and per day, never per request. Tiny pairs (< 50 m) MUST stay on Haversine and MUST be tagged `estimated`.

### Out of scope

- Live reclassification on provider recovery.
- Tooltip text on dashed polylines (the `routingMode` bottom-left badge covers the global "Ruta real / Línea recta" indicator).
