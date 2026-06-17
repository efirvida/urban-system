# Unreachable POI Handling Specification

## Purpose

Reject POIs with no real road to home at the API entry point so the optimizer never sees them. Surface excluded POIs to the user and to the day-editor so the route the system calls "optimal" actually has a road back to home.

## Requirements

### Requirement: Pre-filter unreachable POIs at API entry

The system MUST classify each POI as reachable or unreachable, exclude unreachable POIs from optimization, and return them in a new `unreachable: UnreachablePoi[]` field. The classification gate is `home → P` only; intra-day reachability is out of scope for this capability.

#### Scenario: All POIs reachable (happy path)

- GIVEN 5 POIs all connected to home by a real road
- WHEN the user submits optimization
- THEN `days` covers all 5 and `unreachable` is empty

#### Scenario: One POI unreachable

- GIVEN 4 reachable POIs plus POI X with no road from home
- WHEN submitted
- THEN `unreachable` contains X with name + coords; `days` covers only the 4

#### Scenario: All POIs unreachable

- GIVEN every POI is isolated
- WHEN submitted
- THEN `days` is `[]`, `unreachable` lists all POIs, HTTP status is 200

#### Scenario: Geoapify credits exhausted

- GIVEN `geoapifyTried` already covers every pair
- WHEN submitted
- THEN no new Geoapify calls; OSRM is the primary reachability source

#### Scenario: OSRM timeout

- GIVEN OSRM returns null for `home → P`
- WHEN submitted
- THEN P is placed in `unreachable`; the optimizer never sees it

### Constraints

- `unreachable` is additive — existing response shape MUST stay backward-compatible.
- `reoptimizeDay` signature MUST NOT change.
- The pre-filter is O(n) per session; it MUST NOT amplify the number of routing calls.

### Out of scope

- Intra-day reachability (gated on home→P only).
- Visual styling for `routing-source-tracking` (see `routing-source-tracking` spec).
