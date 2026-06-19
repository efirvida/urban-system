# Consensus Matrix Specification

## Purpose

Run multiple routing providers in parallel and produce per-pair distances
with a cross-validated reliability score, so the optimizer and the user
can distinguish "providers agree" from "single provider guessed". The
sequential `RoutingService.route()` path is preserved for fast/preview
mode.

## Requirements

### Requirement: Parallel multi-provider matrix build

`RoutingService.buildConsensusMatrix(locations, home, config)` MUST run
all `BatchRouteProvider`s (`GeoapifyMatrixProvider`, `OrsMatrixProvider`)
in parallel via `Promise.all` and MUST return a
`ConsensusMatrix = Record<string, ConsensusEntry>` where every upper-
triangle pair appears exactly once.

The per-pair `RouteProvider` (OSRM) MUST only run for pairs where EVERY
batch provider returned null — this is the tier fallback rule.

#### Scenario: Both batch providers resolve a pair

- GIVEN `GEOAPIFY_API_KEY` and `ORS_API_KEY` are set
- AND Geoapify and ORS both return finite distances for a pair
- WHEN `buildConsensusMatrix` runs
- THEN the entry carries 2 votes (Geoapify + ORS) AND the OSRM
  fallback is NOT invoked for that pair

#### Scenario: All batch providers fail triggers OSRM fallback

- GIVEN `GEOAPIFY_API_KEY` and `ORS_API_KEY` are set
- AND both batch providers return `null` for a pair (unreachable)
- WHEN `buildConsensusMatrix` runs
- THEN the OSRM per-pair provider fires AND the entry carries
  3 votes (two null batch + OSRM)

#### Scenario: ORS key missing — single batch provider

- GIVEN `ORS_API_KEY` is unset
- WHEN `buildConsensusMatrix` runs
- THEN only Geoapify runs as a batch provider AND OSRM is invoked
  only for pairs Geoapify marks unreachable AND no error is raised

#### Scenario: One batch provider throws

- GIVEN Geoapify rejects with HTTP 5xx mid-build
- WHEN `buildConsensusMatrix` runs
- THEN the failure becomes a `null` vote for that provider AND
  surviving votes are still scored

### Requirement: `ConsensusEntry` shape

`ConsensusEntry` MUST carry `distance: number`, `reliability: number` in
`[0, 1]`, and `votes: Array<{ provider: string; distance: number | null }>`.
A `null` vote MUST mean "provider reports the pair as unreachable" and
MUST NOT be coerced to `0`.

#### Scenario: Entry round-trips through `OptimizeParams`

- GIVEN a `ConsensusEntry` is produced
- WHEN it is passed via `OptimizeParams`
- THEN `distance`, `reliability`, and `votes` all survive intact
  through to the results panel

### Requirement: Reliability scoring

Reliability MUST equal the fraction of **providers with data** whose
`distance` falls within `CONSENSUS_TOLERANCE` (default 10% of the chosen
distance) of the median. `null` votes (provider has no data for this pair)
SHOULD NOT count in the denominator — only providers that returned a finite
distance are considered. If no provider has data, reliability is `0`.

#### Scenario: Three providers agree

- GIVEN Geoapify 12.0 km, ORS 12.1 km, OSRM 11.9 km
- WHEN reliability is scored
- THEN `reliability === 1.0` (3/3 finite providers agree)

#### Scenario: Two providers agree, one disagrees

- GIVEN Geoapify 12.0 km, ORS 12.1 km, OSRM 18.0 km
- WHEN reliability is scored
- THEN `reliability ≈ 0.67` (2/3 finite providers agree)

#### Scenario: One provider unreachable (null) — does not count

- GIVEN Geoapify 12.0 km, ORS null, OSRM 12.0 km
- WHEN reliability is scored
- THEN only the two finite votes are counted AND `reliability === 1.0`
  (2/2 finite providers agree; null does not penalize)

#### Scenario: Single provider with data is always reliable

- GIVEN Geoapify null, ORS 12.0 km, OSRM null
- WHEN reliability is scored
- THEN `reliability === 1.0` (1/1 finite providers agree) AND the pair
  is reachable

### Requirement: Tier priority and sub-threshold infinity

The chosen `distance` MUST follow tier priority `GeoapifyMatrix` >
`OrsMatrix` > `OsrmPerPair` > `Infinity`. When `reliability < 0.34`
(roughly one of three providers agrees), the entry's `distance` MUST be
`Infinity` and the optimizer MUST reject the pair (per
`strict-matrix-contract`).

#### Scenario: Sub-threshold pair resolves to Infinity

- GIVEN two providers unreachable and one finite vote
- WHEN the entry is built
- THEN `distance === Infinity` AND `reliability < 0.34`
  AND the optimizer rejects the pair

#### Scenario: Tier tiebreak on agreement

- GIVEN 3/3 agree but Geoapify returns 12.0 km and OSRM returns 12.1 km
- WHEN the entry's distance is chosen
- THEN the Geoapify value (highest tier) wins

### Requirement: Opt-in API and per-provider cache keying

`buildConsensusMatrix` MUST coexist with the existing
`buildDistanceMatrix` and the sequential `RoutingService.route()`. The
matrix cache key MUST include the provider set so a hit on one provider
does not satisfy a miss on another.

#### Scenario: Fast preview still uses sequential route

- GIVEN the request does not opt in to consensus
- WHEN the API processes it
- THEN the sequential `route()` path runs unchanged

#### Scenario: Per-provider cache hit avoids re-fetch

- GIVEN a point set was already resolved by Geoapify 30 seconds ago
- WHEN `buildConsensusMatrix` runs again with the same point set
- THEN Geoapify returns the cached result without an HTTP call

## Constraints

- `consensusMatrix` is additive. The legacy `Record<string, number>` and
  `MatrixEntry` shapes from `strict-matrix-contract` MUST keep working.
- `Infinity` propagation from `strict-matrix-contract` applies unchanged.
- The `RouteProvider` interface MUST NOT change; new providers implement
  it like every other provider.
