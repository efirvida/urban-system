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
the available providers (`GeoapifyMatrixProvider`, `OrsMatrixProvider`,
`OsrmProvider`) in parallel via `Promise.all` and MUST return a
`ConsensusMatrix = Record<string, ConsensusEntry>` where every pair
appears exactly once.

#### Scenario: All three providers respond

- GIVEN `GEOAPIFY_API_KEY` and `ORS_API_KEY` are set
- WHEN `buildConsensusMatrix` runs
- THEN each provider fires concurrently AND every `ConsensusEntry`
  carries 3 votes

#### Scenario: ORS key missing falls back to two providers

- GIVEN `ORS_API_KEY` is unset
- WHEN `buildConsensusMatrix` runs
- THEN only Geoapify and OSRM run AND every entry carries 2 votes
  AND no error is raised

#### Scenario: One provider throws

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

Reliability MUST equal the fraction of providers whose `distance` falls
within `CONSENSUS_TOLERANCE` (default 10% of the chosen distance) of the
median. Unreachable votes MUST NOT count as agreement.

#### Scenario: Three providers agree

- GIVEN Geoapify 12.0 km, ORS 12.1 km, OSRM 11.9 km
- WHEN reliability is scored
- THEN `reliability === 1.0`

#### Scenario: One provider disagrees

- GIVEN Geoapify 12.0 km, ORS 12.1 km, OSRM 18.0 km
- WHEN reliability is scored
- THEN `reliability ≈ 0.67`

#### Scenario: One provider unreachable

- GIVEN Geoapify 12.0 km, ORS null, OSRM 12.0 km
- WHEN reliability is scored
- THEN only the two finite votes count AND the `null` vote does not
  count as agreement

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

#### Scenario: Per-provider cache miss

- GIVEN Geoapify pair is cached but the ORS pair is not
- WHEN `buildConsensusMatrix` runs
- THEN only the ORS pair is fetched AND a cache-hit log line is emitted
  for Geoapify

## Constraints

- `consensusMatrix` is additive. The legacy `Record<string, number>` and
  `MatrixEntry` shapes from `strict-matrix-contract` MUST keep working.
- `Infinity` propagation from `strict-matrix-contract` applies unchanged.
- The `RouteProvider` interface MUST NOT change; new providers implement
  it like every other provider.
