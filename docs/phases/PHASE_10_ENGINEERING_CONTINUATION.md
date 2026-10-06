# Phase 10 continuation — Foundry as a dependable engineering system (scope, FROZEN at start)

Authoritative roadmap: `docs/phases/phase-10.md` (Agent Foundry). Baseline: `PHASE_10_IMPLEMENTATION.md` and commits through `0591c87` (need gate, lifecycle, worker governor, evaluation, API/UI, scheduler) — **preserved, not rebuilt**.
Source of the additional requirements: Mark's continuation directive of 2026-10-06 (items A–X). The "NEXT-FOUNDRY-ENGINEERING" research proposal and Kimi knowledge bundle (Mark's Desktop planning notes, untouched) are explicitly the *next* phase; this continuation implements only integration hooks for them (see `PHASE_10_FOUNDRY_NEXT_PHASE_HOOKS.md`), not durable knowledge/skill memory.

## Gap analysis (what exists vs what is missing)
| Capability | Exists | Missing (this continuation) |
|---|---|---|
| Agent identity/lifecycle/worker governor/scheduler | `lib/agents/ops` | assignment-level state (parent mission, expected outputs, completion conditions, tools, workspace, actual executor, budgets, checkpoints, dependencies, stop reason) |
| Need-based creation | need gate | reuse-vs-create decision from required capabilities and evidence-typed capability (demonstrated / evidence-backed recommendation / inferred / untested) |
| Code-aware planning | `foundryCodeIntelligence` (TS AST, War Room prefixes), `foundryEngineeringPlan` (campaign task graph) | workspace-general planner answering WHAT/WHERE/DEPENDS/LAYERS/TESTS-now/TESTS-needed/RUNTIME from code evidence; keyword hints only as discovery aids |
| Complete-feature workflow | campaign (fixture-specific) | bounded, general cross-layer workflow with slices, validation, checkpoints, evidence-driven repair, real-model execution |
| Evidence-driven debugging | debug/hypothesis fragments | ledger: exact command/result, hypothesis revision, "why next repair differs", wrong-test detection, no repeated edit without new evidence, UNDETERMINED |
| Measurable learning | Phase 9 evaluation | lesson capture, applicable-lesson retrieval for similar tasks, applied/not-applicable evidence, A/B proof |
| Handoff / recovery | interrupted-run recovery (ops) | structured engineering checkpoints, command-effect (consequential action) ledger, file-state reconciliation, successor packet |
| Controls | worker Stop/Resume, agent lifecycle | assignment Pause/Resume/Cancel with explicit cancellation dispositions, retire-blocks-assignment |
| Honest visibility | new ops UI | remove fake values in the old `lib/agents/foundry` scaffold (e.g. synthetic queue depth, zero-filled metrics); simple status first (Goal / Doing now / Verified / Remaining / Blocker / Approval) with Details |
| Scorecard | none | measured baseline of engineering performance (UNKNOWN where unmeasured) |

## Slices
P10-J assignments + specialist need/reuse/creation · P10-K code-aware planner · P10-L continuity (checkpoints, command-effect ledger, reconciliation, successor handoff, recovery) · P10-M evidence-driven debugging ledger · P10-N complete-feature workflow engine + real local-model executor + isolated cross-layer fixture · P10-O lessons + Phase 9 integration + scorecard · P10-P honest visibility (simple status, controls, scaffold fixes, API/UI) · P10-Q integration hooks doc · independent reviews · installed acceptance (isolated data roots, real Ollama model, real tests).

## Rules carried forward
Commander authority for approvals (acceptance acts through the Commander session); no push/merge/deploy/spend; loopback model calls only (local Ollama); no new downloads; UNKNOWN never zero; secrets refused from persisted state; explicit-path commits; automatic mission-history backup before any launch; isolated data roots for destructive/recovery acceptance.

## Proof standard
A mocked/scripted success is **not** end-to-end proof. Test doubles are allowed only for mechanics validators and are labelled; the end-to-end claims (complete feature, evidence-driven repair, learned-correction effect, specialist lifecycle) must use the real local model and real test commands in an isolated fixture, with failures and partial results recorded as they happen. If the local model cannot achieve a milestone, the verdict says so (PARTIAL), with evidence.

## Acceptance (from the directive)
Code-aware planning from evidence incl. a misleading-keyword case · persistent cross-layer feature (storage+API+UI+tests+runtime) without manual repair of Foundry's patch · evidence-driven repair after a real failing test · lesson captured then retrieved and effective on a similar later task · specialist reuse vs creation decision, specialist failure, successor continuity · restart/crash recovery without duplicating consequential actions · pause/resume/stop/cancel/retire against real execution · resource limits and risky-effect gating · scheduler operation preserved · honest status/visibility · scorecard baseline · independent review (HIGH blocks) · installed acceptance.
