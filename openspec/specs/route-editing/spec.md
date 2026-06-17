# Route Editing Specification

## Purpose

Define the in-app **RouteEditor**: POI re-assignment across days with explicit save semantics, map coordination, and constraint feedback. The system is a route **optimizer** — within-day order is never user-controlled.

## Requirements

### Requirement: Auto-Reoptimization on Day Mutation

The system MUST call `reoptimizeDay()` on a day whenever a POI is added to or removed from it. The displayed order MUST equal the reoptimized result, never the drop position.

#### Scenario: Add triggers reopt

- GIVEN a day with [A, B, C]
- WHEN the user drops X into that day
- THEN `reoptimizeDay([A, B, C, X])` runs and its result is shown

#### Scenario: Remove triggers reopt

- GIVEN a day with [A, B, C, D]
- WHEN the user removes B
- THEN `reoptimizeDay([A, C, D])` runs and the polyline is recomputed

### Requirement: Drag-and-Drop Across Days

The system MUST allow dragging a POI between any two `DayColumn`s and between a `DayColumn` and the `UnassignedPool`. Within-day reorder MUST NOT be possible — drop index in a source/target day is ignored.

#### Scenario: Reassignment and within-day drops

- GIVEN POI B is in Day 1
- WHEN the user drags B onto Day 2
- THEN B leaves Day 1, joins Day 2, and both days are reoptimized
- WHEN the user drags C from Day 1 into the pool
- THEN Day 1 is reoptimized and C appears in the pool
- GIVEN Day 1 has [A, B, C]
- WHEN the user drops D between B and C
- THEN the final order is `reoptimizeDay([A, B, C, D])`

### Requirement: Save / Discard / Undo

The system MUST snapshot `result.days` at edit-mode entry. `Apply` commits the session to `result` and clears the undo stack. `Discard` restores the snapshot. `Undo` pops the last mutation (cap 20). The toolbar MUST disable `Undo` when empty and `Apply`/`Discard` when clean.

#### Scenario: Apply, Discard, Undo

- GIVEN a dirty session
- WHEN the user clicks Apply
- THEN `result.days` is replaced with `editableDays` and `dirty` is false
- WHEN the user then mutates and clicks Discard
- THEN `editableDays` is replaced with the entry snapshot
- GIVEN 3 mutations have been made and the user clicks Undo twice
- THEN the session reverts to the state after the first mutation

### Requirement: Per-Day Constraint Gauge

Each `DayColumn` MUST render a gauge whose fill ratio derives from `config.constraintType` and `config.constraintValue`. Fill MUST be green < 80%, yellow 80%–100%, red ≥ 100%. In `hours+visits` mode the binding ratio is `max(hoursRatio, visitsRatio)` (the more restrictive constraint drives the gauge).

#### Scenario: Hours mode hits red at 100%

- GIVEN `constraintType = "hours"`, `constraintValue = 8`
- WHEN a day reaches 8.0 hours
- THEN the gauge fills 100% and is red

#### Scenario: hours+visits uses binding ratio

- GIVEN `hoursRatio = 0.9`, `visitsRatio = 0.6`
- WHEN the gauge renders
- THEN the binding ratio is 0.9 and the color is yellow

### Requirement: Map-to-Sidebar POI Selection

A POI marker click MUST select that POI in the editor sidebar and highlight its day column. Selection MUST NOT mutate the day's POI order.

#### Scenario: Map click selects a POI

- GIVEN POI B is in Day 1 and edit mode is active
- WHEN the user clicks B on the map
- THEN B is marked selected in Day 1 and Day 1 is highlighted

### Requirement: Lifecycle and Icons

`RouteEditor` MUST mount client-side only and render every control with `lucide-react` icons — no emoji. The session MUST be discarded on view exit.

#### Scenario: Client-only mount

- GIVEN the results view is hydrated
- WHEN the user toggles edit mode
- THEN `<RouteEditor />` mounts after the toggle and no `window` code runs during SSR

#### Scenario: No emojis in editor chrome

- GIVEN the editor is rendered
- WHEN the toolbar and headers are inspected
- THEN every icon is a `lucide-react` component
