# Phase 10 — Agent Foundry and Long-Lived Operations: Implementation Scope (FROZEN)

**Authoritative source:** `docs/phases/phase-10.md` (read completely). This document only decomposes it; the roadmap wins on any conflict.
**Exact title:** Phase 10: Agent Foundry and Long-Lived Operations.
Code lives in `lib/agents/ops/`. Evidence: `/home/chosenone/Documents/Codex/Seagate/war-room-backups/evidence/phase10/`.
Baseline: live branch `321f30c` (Phase 9 merged). `main` untouched.

## Purpose (from the roadmap)
A governed process for creating, evaluating, operating and retiring specialized agents, born from validated operational need (not novelty), with clear permissions, memory scopes, approval boundaries and measurable usefulness; plus visible, controllable long-lived background workers.

## Required outcomes → acceptance criteria mapping
| Roadmap criterion | Delivered by |
|---|---|
| War Room has an agent lifecycle doctrine | P10-A: need-detection gate + lifecycle state machine NEED_DETECTED→PROPOSED→APPROVED→ACTIVE⇄PAUSED/UNDER_REVIEW→RETIRED (+REJECTED), fail-closed, auditable, durable |
| Adaptive agents bounded by permissions, memory scopes, audit | P10-B: adaptation proposals (recommend-only); forbidden kinds rejected; scope-bounded; permission changes = Commander-reviewed requests |
| Long-lived workers have visible scope, controls, logs | P10-C: worker spec (scope, runtime limits, version), runtime governor, run log, stop controls |
| Background ops preserve approval gates for risky work | P10-C: external action / production change / spend / external communication are blocked unless a recorded Commander approval or a narrow pre-approved policy covers it |
| Agent usefulness can be measured and reviewed | P10-D: outcome evaluation on the roadmap's 10 dimensions; unknown stays UNKNOWN; narrow/retrain/merge/retire recommendations (Commander-gated); consumes Phase 9 evidence |
Operator visibility (roadmap "Background Operations"): P10-E read API + Commander-authenticated control API + bounded UI.

## Roadmap sections implemented
- **Agent Foundry:** an agent may be proposed only when all 7 roadmap criteria are evidenced (recurring pattern, validated workflow with measurable value, clear permission scope, useful memory boundary, repeatable I/O contract, known escalation path, failure/drift review process). Missing criterion = proposal refused ("NO EVIDENCE"), never defaulted.
- **Adaptive agents:** permitted = recommend workflow change, narrow/broaden task classification, update retrieval strategy, flag weak tool, suggest permission change for review, retire a step. Forbidden = silent permission expansion, hidden external action, production mutation, spending, external communication.
- **Task specialization:** the roadmap's 10 areas; scope check returns IN_SCOPE or ESCALATE (domain or risk class exceeded; escalation path required).
- **Long-lived workers:** the roadmap's 7 categories; explicit scope, runtime limits, logging, failure handling (trip to PAUSED after N consecutive failures), stop controls.
- **Background operations record** per run: worker identity+version, assigned mission, permission scope, memory scope, tools used, outputs, escalations, errors+recovery actions, resource usage and cost (UNKNOWN when not available).
- **Agent evaluation:** task success rate, accuracy, Commander correction rate, useful escalation rate, cost and latency, failure rate, audit completeness, approval-doctrine compliance, memory quality, operator-workload reduction. Dimensions with no evidence source report UNKNOWN. Underperformers → recommendation to narrow / retrain via prompt-or-workflow review / merge / retire (never applied automatically).

## Builds on (not replaced)
Phase 9 `lib/recursive-learning` (evaluation evidence, Commander-session pattern, append-only log, UNKNOWN discipline); `lib/agents/foundry/*` (existing static blueprint scaffold + Supabase tables remain untouched; `lib/agents/ops` is the durable local operational layer beside it); `requireCommanderSession`; Foundry data root (app-data). Existing scaffold deficiencies (zeros for missing metrics, synthetic queue depth) are NOT carried into the new layer.

## Architecture boundaries
- New module `lib/agents/ops/` (types, durable log, lifecycle, need gate, specialization, adaptation, worker governor, evaluation, read model, API handlers) — pure functions + one append-only JSONL store in the per-user app-data root (`<app-data>/agent-foundry/`, override `WAR_ROOM_AGENT_FOUNDRY_DIR`).
- Identity: agent id is stable and independent of any model process/provider. Provider/model is recorded per run as the *actual executor*.
- Separate records: agent (identity/scope), worker spec (runtime), run (execution), proposal/decision (governance), evaluation (derived). No single opaque object.
- No hooks into Foundry startup/recovery. Phase 10 never rewrites mission records.

## Governance boundaries
- Commander authority required for: approve agent, activate, retire, approve capability/permission change, approve a worker's external/production action, resume a stopped worker. Identity is derived from the authenticated Commander session in routes (never from request input).
- No self-approval, no capability self-expansion, no spending, no external communication, no production mutation without recorded approval.
- Agents cannot grade their own critical work as accepted: an evaluation/retirement recommendation is produced by the evaluator, applied only by a Commander decision.
- Phase 9 recommendations remain recommendations; nothing here mutates routing/hard policy.
- Secrets never persisted: all persisted strings pass the Phase 9 secret detector; events with detected secrets are refused.

## Data/storage
Append-only JSONL (records: need, agent, transition, proposal, decision, worker, run, stop, evaluation snapshot). Torn-line tolerant, dedupe by record id, restart-safe by re-derivation. Retention: unbounded append; bounded payload sizes (truncate outputs, store references).

## Runtime
No auto-start at boot. Workers run only when (a) a Commander triggers "run now"/"run due" through the authenticated control API, or (b) a future opt-in scheduler (NOT in this phase's default). Every run is time-boxed by runtime limits; cancellation/stop checked before and after.
First-party read-only workers (real, installed-runtime-provable): **evaluation-scoring worker** (summarizes Phase 9 evidence → emits agent/provider findings) and **documentation-freshness worker** (reports docs staleness). Other categories are supported by the framework and ship as specs without runners.

## Non-goals (explicitly out of scope; not in the roadmap)
Cross-worker mission handoff, builder/reviewer pairing, competing implementations, workspace locking/Git protections (belong to the Foundry mission layer), pseudo-personality systems, new providers/paid services, Terra/Ascension/HVS/VR/Council/kernel work, production deploy, any change to Foundry startup recovery.

## Slices
P10-A model+lifecycle+need gate+durable log · P10-B specialization/escalation + bounded adaptation · P10-C worker spec/governor/run log/stop controls · P10-D evaluation (+Phase 9 consumption) · P10-E read model, API (read + Commander controls), UI · P10-F first-party workers · P10-G governance/adversarial/integration validation + independent review · P10-H installed-runtime acceptance.

## Acceptance tests (derived from roadmap)
1 lifecycle illegal transition rejected (fail closed) · 2 agent cannot be proposed without all 7 need criteria · 3 only Commander can approve/activate/retire; self-approval refused · 4 retired agent never reactivates/accepts work · 5 durable agent + state survive restart · 6 torn/corrupt/duplicate log lines tolerated · 7 specialization boundary → ESCALATE out of domain/risk · 8 forbidden adaptation kinds refused; permission change only as request · 9 adaptation cannot exceed memory/permission scope · 10 worker cannot run unless agent ACTIVE and spec approved · 11 runtime limits enforced (timeout, daily cap, consecutive-failure trip) · 12 stop control halts and persists; resume requires Commander · 13 risky actions (external/production/spend/communicate) blocked without approval; pre-approved narrow policy honored · 14 every run records all roadmap fields (audit completeness) · 15 cost/usage UNKNOWN not zero · 16 evaluation dimensions UNKNOWN when no evidence; min-sample gating · 17 underperformer → recommendation only, never auto-applied · 18 Phase 9 evidence consumed without mutating Phase 9 or routing · 19 secrets never persisted · 20 read API Commander-gated; control API derives identity from session · 21 operator view equals durable state · 22 no writes outside the agent-foundry dir; no mission-record rewrites · 23 recovery on restart idempotent: RUNNING runs with no heartbeat marked INTERRUPTED once · 24 installed runtime behaves like source validation.

## Rollback
All additive. Revert the Phase 10 commits; delete `<app-data>/agent-foundry/` (derived state only). Existing Foundry/Phase 9 behavior unchanged. Canonical launcher and installed runtimes untouched; new versioned install only at P10-H, mission-history backup (done: `foundry-missions-pre-phase10-20261006T124815Z`) before every launch.

## Evidence
`phase10-scope-freeze.md`, `phase10-architecture.md`, `phase10-slice-*.md`, `phase10-validation.md`, `phase10-independent-review.md`, `phase10-installed-acceptance.md`, `phase10-final-receipt.md` under the evidence directory.

## Trust model and known limits (added after independent review round 1; scope itself unchanged)
- The agent-foundry log is **trusted-local state**. Replay enforces state-machine legality and structural validity (need gate re-checked, worker limits/scope/effects re-checked, proposals first-wins, one scope application per proposal, terminal run records final) but not authenticity: anyone who can write the file can append records. HMAC signing with an out-of-directory key is a deferred hardening.
- Workers run **in-process and cooperatively**. A runner that ignores the abort signal cannot be killed; after timeout/stop/finish every `requestEffect` is denied and later results are not recorded. Effect gating is **declared-effects-only**: an undeclared side effect is not detectable, and compliance is labelled accordingly. Built-in workers are read-only.
- An effect approval authorizes **one run** (any number of calls of the approved effects within it). Start check + approval claim + start record are one cross-process critical section (O_EXCL lock file).
- Not delivered / nominal in this phase: only 2 of 7 worker categories ship runners (evaluation_scoring, documentation_freshness); `checkTaskScope` is a library gate not yet wired to an assignment path; adaptation proposals are record-only (a Commander-approved permission request can be applied as a new agent version, nothing else is applied); memory quality and operator-workload reduction have no evidence source (UNKNOWN); no scheduler (workers run only on Commander trigger).

## P10-I — Bounded background scheduler (addendum; closes the disclosed "no scheduler" gap)
Design (decided by the roadmap's "long-lived workers ... background operations ... visible and controllable"):
- **Opt-in at three levels:** (1) process: `instrumentation.ts` starts the Agent Foundry scheduler unless `WAR_ROOM_AGENT_SCHEDULER=off`; (2) global Commander switch (default DISABLED; Pause/Resume scheduling); (3) per-worker Commander schedule (enable/disable + cadence). Only workers of an eligible category (evaluation_scoring, documentation_freshness: the two first-party read-only runners) with NO pre-approved effects can be scheduled.
- **Never risky:** the scheduler never passes an approval, so any protected effect is BLOCKED; a BLOCKED scheduled run auto-disables that worker's schedule (system may only disable) pending Commander review. Scheduling obeys STOPPED, agent state (ACTIVE only), failure trip, daily cap, single-run guard, a global concurrent-scheduled-run cap, retry backoff (cadence × 2^failures, max ×16), capability boundaries.
- **Idempotent, multi-process safe:** a due slot is claimed with a deterministic record id (`sched:<worker>:<slot>`) inside the log lock; the losing process gets CLAIM_LOST. Run id is deterministic too.
- **No catch-up storm:** at most one run per worker per tick; overdue slots collapse into one run (reason records the collapsed count); next due = claim time + cadence. First run after enabling is one cadence later. Startup delay + max 2 claims per tick.
- **Durable state (log):** schedule (enabled, cadence, by, at), schedulerGlobal, schedClaim (claim identity, slot, instance, at), schedDecision (RUN/SKIP, reason, next eligible; skips de-duplicated). Run records gain `origin: manual|scheduled` and `claimId`. Scheduler health is a small overwritten file (`scheduler-health.json`: instance, pid, last tick, last error), never inferred from the existence of a timer.
- **Lifecycle:** `startAgentScheduler` = recover interrupted Agent Ops runs, then bounded ticks (default 30s interval, unref'd timer, failure-safe, singleton per process). It imports nothing from Foundry mission code and never reads or writes mission records or Foundry startup recovery.
- **Controls/visibility:** global status, health, per-worker enable/cadence/next eligible/last automatic run/skip reason/claim, Pause/Resume scheduling, Run now (no "run continuously"). Runs are labelled manual / scheduled / recovering.
- **Acceptance (installed, isolated data root):** short cadence, no "Run now": scheduler claims and runs docs-freshness, UI updates; restart: schedule survives, no duplicate, no catch-up storm; STOP from UI: no automatic run beyond one cadence; Resume: operation resumes at next cadence.
