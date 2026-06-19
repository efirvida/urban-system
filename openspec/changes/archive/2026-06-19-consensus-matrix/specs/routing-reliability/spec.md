# Routing Reliability Specification

## Purpose

Let the optimizers consume the per-pair reliability produced by the
consensus matrix so route candidates are biased toward high-confidence
legs, without changing the underlying solver algorithms or the legacy
matrix shape.

## Requirements

### Requirement: `OptimizeParams.consensusMatrix` field

`OptimizeParams` MUST accept an optional `consensusMatrix:
Record<string, ConsensusEntry>` field. When absent, the optimizers MUST
behave identically to the pre-change baseline.

#### Scenario: Field absent (legacy path)

- GIVEN `consensusMatrix` is not in `OptimizeParams`
- WHEN CW or NSGA-II runs
- THEN optimizers read `params.matrix` only AND the result is
  bit-equivalent to the pre-change baseline

#### Scenario: Field present alongside legacy matrix

- GIVEN `consensusMatrix` is provided alongside `matrix`
- WHEN CW or NSGA-II runs
- THEN both fields are read AND reliability data flows into the result

### Requirement: Reliability-aware leg rejection

CW and NSGA-II MAY reject a leg whose per-pair reliability falls below
`RELIABILITY_FLOOR` (default `0.34`). The rejection MUST be additive:
it MUST NOT alter the algorithm core (giant-tour split, NN reorder, GA
mutation/crossover, NSGA-II non-dominated sort).

#### Scenario: Leg below floor is rejected

- GIVEN a leg with `reliability = 0.33`
- WHEN CW evaluates the route
- THEN the leg is treated as unreachable AND the candidate is rejected

#### Scenario: Leg at floor is accepted

- GIVEN a leg with `reliability = 0.34`
- WHEN CW evaluates the route
- THEN the leg is accepted normally

#### Scenario: Solver core unchanged

- GIVEN any input
- WHEN CW or NSGA-II runs with or without `consensusMatrix`
- THEN the algorithm code path is identical except for the optional
  reliability pre-filter

### Requirement: Winner selection still by distance

The best-result selection rule from `optimization-results` (lowest
`totalDistance`, ties broken by fewer `totalDays`) MUST apply
unchanged. Reliability MUST surface alongside each `OptimizerResult`
and MUST NOT demote a shorter route in favor of a longer but more
confident one.

#### Scenario: Shortest route still wins

- GIVEN CW returns 95 km (avg reliability 0.6) and NSGA-II returns
  110 km (avg reliability 1.0)
- WHEN the response is built
- THEN the winner is CW (lowest distance) AND both `avgReliability`
  fields are exposed in the `OptimizerResult`

#### Scenario: Reliability surfaces in `OptimizerResult`

- GIVEN an optimizer consumes `consensusMatrix`
- WHEN its `optimize()` returns
- THEN the result carries `avgReliability: number` in `[0, 1]`
  representing the mean reliability of the legs it used

## Constraints

- The legacy `matrix: Record<string, number>` field MUST remain
  unchanged. `consensusMatrix` is additive.
- CW, NSGA-II, and the GA post-refinement core algorithms MUST NOT be
  rewritten. Only the optional reliability pre-filter MAY be added.
- `Infinity` propagation from `strict-matrix-contract` applies
  unchanged; reliability is purely an additional signal.
