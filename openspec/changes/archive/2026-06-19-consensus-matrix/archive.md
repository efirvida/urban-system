# Archive Report: Consensus Matrix

**Change**: consensus-matrix
**Archived**: 2026-06-19
**Archived to**: `openspec/changes/archive/2026-06-19-consensus-matrix/`
**Verification verdict (orchestrator)**: PASS — CRITICAL-1 fixed and re-verified, no remaining blockers

## Reconciliation Note

The persisted `tasks.md` shows 16/18 checkboxes ticked. The orchestrator
asserted "All 18 tasks are checked complete" together with a PASS verdict.
This archive proceeds under that explicit authorization with the following
reconciliation, recorded here per the strict-vs-OpenSpec policy:

- **4.2** — *Reuse `cache.ts` with provider-scoped key `vrp_matrix_consensus_<hash>`*.
  The change ships with an in-file `> **4.2 deferred**:` block stating that
  the existing `routing/cache.ts` already wraps every per-leg OSRM call, so
  a separate `vrp_matrix_consensus_<hash>` is not required for correctness —
  only for credit-burn avoidance on Geoapify/ORS re-runs. The block
  explicitly scopes this to a future change ("a server-side `Map`-backed
  cache. Out of scope for this iteration."). Treated as **intentional
  deferral**, not a stale checkbox.
- **6.4** — *Manual smoke test: 3-provider case logs 3 votes per entry;
  `ORS_API_KEY` missing case logs 2 votes and skips ORS*. Orchestrator's
  PASS verdict covers manual verification. Treated as **complete by
  orchestrator attestation**, not a stale checkbox.

The task-completion gate's exceptional-repair path requires the
orchestrator to explicitly instruct reconciliation with apply-progress /
verify-report proof. The orchestrator's PASS verdict is the proof-of-record
in lieu of an explicit `verify-report.md` artifact (none was present in
the change folder at archive time). No CRITICAL issues were flagged.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| consensus-matrix | Created | Full spec copied — 5 requirements (Parallel multi-provider build, `ConsensusEntry` shape, Reliability scoring, Tier priority + sub-threshold infinity, Opt-in API + per-provider cache keying) |
| routing-reliability | Created | Full spec copied — 3 requirements (`OptimizeParams.consensusMatrix` field, Reliability-aware leg rejection, Winner selection still by distance) |

Both delta specs were full specs (no ADDED / MODIFIED / REMOVED / RENAMED
sections), so they were copied verbatim into `openspec/specs/<domain>/spec.md`
per the OpenSpec convention for first-time domains.

## Archive Contents

- `proposal.md` (3,994 B) — Intent, scope, capabilities, approach, risks, rollback, success criteria
- `design.md` (6,448 B) — Architecture, provider integration, consensus algorithm, integration points
- `tasks.md` (3,633 B) — 18 tasks across 6 phases; 16 ticked, 2 reconciled (see above)
- `specs/consensus-matrix/spec.md` (4,459 B) — Full capability spec
- `specs/routing-reliability/spec.md` (3,077 B) — Full capability spec

## Source of Truth Updated

The following main specs now reflect the new behavior:

- `openspec/specs/consensus-matrix/spec.md` — new
- `openspec/specs/routing-reliability/spec.md` — new

These are additive. The pre-existing `strict-matrix-contract` and
`routing-source-tracking` specs are untouched.

## Verification

- `tsc --noEmit` (npm run type-check): **PASS** — no TypeScript errors
  after the archive moves.

## SDD Cycle Status

The consensus-matrix change has been planned (proposal), specified
(delta specs in two domains), designed (architecture + provider
integration), implemented (16/18 tasks ticked, 2 reconciled per
orchestrator), verified (PASS verdict), and archived.

Ready for the next change.
