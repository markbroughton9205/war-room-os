# Foundry Phase 9 — POLISHED DAILY-DRIVER EXPERIENCE (P9-0 scope freeze)

Baseline: `ad5ad5e612cba6d44777102f446dea19b6b46446` on `live-council-intelligence-repair`, clean tree,
typecheck PASS, desktop build check PASS, frozen lockfile PASS. Nebula storage healthy (111 → 659 GB free after
storage cleanup). Phase-8 deferred HOLD items (globals.css CEOL, main.cjs M05, M30 research set, X-INS D18) are
excluded and must not be absorbed.

## Problem statement
Foundry is functionally built but not yet pleasant to run every day. Operators still cannot reliably answer, at a
glance: Is Foundry up? Which missions are live? What is each worker doing? Is the state on screen true? What failed,
why, and what do I do next? This phase makes the existing capability set dependable, understandable, recoverable,
and resource-disciplined — without expanding feature scope.

## Included systems (bounded)
1. Startup / resume / state truth — predicted cold/warm start, mission resume, honest overall status
   (`lib/native-builder/engineerStatus.ts`, `foundryCampaignRecovery.ts`, `foundryMissionRuntime*`,
   server-lifecycle locks).
2. Mission Control daily UX — clear state/progress/blockers/receipts/actionable failures
   (`app/api/foundry/mission-control`, `components/war-room/foundry/FoundryMissionControl*`).
3. Workbench operator flow — verified mission policy authoritative, obvious command ownership, honest refusals
   (`app/api/foundry/workbench`, workbench policy from Phase 8).
4. Provider/worker health and routing clarity (`foundryBrainStatus`, `localModelHealth`, `localCoder`, provider
   routing surfaces).
5. Failure/recovery UX — stale locks, duplicate mission prevention, retry, visible recovery reason
   (`buildLock.ts`, `COMMAND_POLICY`/retry paths).
6. Performance/resource discipline — no runaway polling, bounded `.broker.tmp` litter, mission history scaling.
7. Receipts/evidence surfacing — completion proof accessible, honest failure states, installed-vs-source truth
   distinguishable.
8. Daily-driver polish — honest empty/loading/refusal states, dead control removal, consistent terms.
9. Installed-runtime verification — build/install into canonical runtime, identity proof, restart/resume,
   controlled failure/recovery, rollback preserved.

## Explicit exclusions
Terra world, HVS film generation, DeepSeek/Hermes harness expansion, new kernel/OS work, VR, Council replacement,
broad provider proliferation, Phase 10 hardening, external builders, agent civilizations, giant UI redesign,
the 7 deferred Phase-8 HOLD hunks, any security/auth weakening.

## Issue inventory (operator-relevant, from repo findings)
- Stale `.broker.tmp` * source litter in `components/`, `lib/`, `desktop/runtime` trees (ignored but present).
- Stale generated `desktop/dist-release`/`desktop/runtime` trees from previous installs.
- No CI configured → no PR-level protection; recorded local validations only.
- Claude OAuth expired → security/auth/production conclusions pending independent review.
- Mission Control lists missions/jobs but operator-facing "what now" affordance is uneven; recovery states and
  receipt access need consistent surfacing (acceptance tests below define the bar).
- Resource discipline after the storage cut: test-only checkpoints, media tmp, and install accumulation must
  stay bounded during Phase 9 builds.

## Implementation slices (dependency order)
- P9-A Startup/Resume/State Truth: validate no phantom EXECUTING after restart; recovery snapshot correctness.
- P9-B Mission Control daily UX: honest status, progress, blockers, receipts links.
- P9-C Workbench operator flow: policy-gated refusals explain why; ownership visible.
- P9-D Provider/worker health + routing clarity: unavailable provider → useful fallback/refusal, no silent switch.
- P9-E Failure/recovery UX: stale lock recovery messaging, duplicate mission prevention, operator retry.
- P9-F Performance/resource discipline: broker.tmp cleanup guard, tmp/checkpoint retention rules, poll audit.
- P9-G Receipt/evidence surfacing: completion proof accessible; installed-vs-source truth surfaced.
- P9-H Daily-driver polish: empty/loading/refusal states, dead-control pass.
- P9-I Installed runtime verification: build, install into canonical runtime (new versioned dir allowed once),
  restart/resume probe, controlled failure/recovery, rollback proof, retention cleanup.

## Objective acceptance criteria (summary)
Cold start predictable; resume shows true states with no phantom activity; worker/provider unavailable produces
fallback/refusal text, never silent switching; stale locks recover deterministically; duplicate missions prevented;
malformed receipt → honest error; canceled mission state stable; history with many missions responsive; receipts
reachable; installed runtime identity verifiable; rollback preserved.

## Validation plan
Per-slice: focused `*.validation.ts` executions, `tsc --noEmit`, desktop build check, frozen lockfile check,
plus new independent acceptance validations written from criteria (not from implementation).
Final: full clean-export typecheck, acceptance suite, runtime identity check, restart/resume probe, controlled
failure injection, rollback dry-run.

## Installed-runtime proof plan
Same procedure used in Phase 8: package via desktop tooling, install to a single new versioned dir, verify
identity from `INSTALL_STAMP.json`, run one Foundry-owned objective via the installed binary, restart, resume,
inject one controlled failure, prove rollback dir intact, delete scratch build artifacts after.

## Rollback plan
- Source: branch `live-council-intelligence-repair`; any Phase 9 work lands as discrete local commits that can be
  reverted by SHA.
- Runtime: keep canonical `…-05bc` as the known-good until a new install validates; keep
  `…-terra-layer-governor` as the retained rollback; one new `…-phase9` dir maximum; remove scratch builds.
- If Phase 9 validation fails: revert commits, leave canonical runtime on Phase 8.

This scope is frozen as of P9-0. Do not expand silently.
