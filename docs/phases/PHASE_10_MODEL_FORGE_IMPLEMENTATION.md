# Phase 10 — Model Forge (Foundry subsystem)

Model Forge lives in `lib/agents/forge/` inside Agent Foundry. It is not a separate application. State is an append-only JSONL
(`model-forge.jsonl`) beside the Foundry log (same data dir, torn-line tolerant, credential-like content refused).

## Implemented now
| Area | Where | Notes |
|---|---|---|
| Registry | `registry.ts`, `store.ts` | Exact Ollama refs, role, status (ACTIVE / BASELINE / FUTURE_HEAVY / CANDIDATE / RETIRED), `routing.eligible`. Statuses are policy, never performance claims. |
| Lineage | `ModelEntry.lineage` | parent, transformation, note. Third-party abliteration is recorded as such; War Room has not re-ablated anything. |
| License honesty | `ModelEntry.license` | Derivatives are `permissive: UNKNOWN` until the model card is checked. |
| Resource profiles | `profile.ts` | Residency from the runtime's own `/api/ps` bytes (`size` vs `size_vram`): FULL_GPU / PARTIAL_OFFLOAD / CPU_ASSISTED / UNKNOWN (MEASURED). Pre-load size-only reasoning is tagged ESTIMATED and never claims FULL_GPU. Also load ms, first-token ms, tokens/s, GPU MiB and system RAM MiB after load, context. |
| Smoke test | `smoke.ts` | Identity (digest from `/api/tags`), responds, structured JSON, a coding reply that is executed, through the same `OllamaModelClient` Foundry uses. |
| Benchmarks | `e2eRealModel.ts` -> `ForgeStore.recordBenchmark` | Same chat-session fixture + independent 12-check verifier for every model; records score, calls, repairs, elapsed, peak GPU/RAM sampled during the run, actual executor, context. Retries/regressions are `UNKNOWN` until measured. |
| Routing evidence | `routing.ts` | Per task class. Only ACTIVE+eligible models; needs a COMPLETED, full-score, real-executor, no-manual-intervention run; ties by repairs then time. No evidence => `NO_EVIDENCE`, never a default. Scripted-double runs and BASELINE models are excluded. |
| CLI | `cli.ts` | `register-pool`, `profile <model>`, `smoke <model>`, `route`, `status`. |
| Validator | `forge.validation.ts` | `pnpm run validate:forge`. |

## Designed, NOT implemented (future Forge slices)
- **Transformations** (`warroom/<family>-engineer-vN` variants): only with a written improvement hypothesis plus a benchmark able to measure it; every variant records its parent and the recipe in lineage. Do not damage a working model to create a variant.
- **Adapters (LoRA)**, **quantization variants**, **training-example curation** (from verified Foundry successes and debug-ledger corrections, secrets-redacted, Commander-approved), **abliteration/permissive experiments** (only on a separate copy, benchmarked against its parent, license reviewed).
- **Load management**: eviction/serialization of large models; needed before the 123B is revisited.
- **123B**: registered as FUTURE_HEAVY, not downloaded. Estimated REQUIRES_OFFLOAD (~70 GB artifact vs ~46 GiB RAM+VRAM). Classification stays ESTIMATED until measured.

## Foundry integration
- `OllamaModelClient` already reports the actual executor and token counts; benchmark records carry them.
- Routing decisions are read by Foundry through `routeFor(taskClass, models, benchmarks)`; wiring it into assignment execution is a follow-up once at least one model has full-score evidence.
- Qwen2.5-coder:14b remains installed as historical baseline only (`historicalBaseline: true` in its benchmark records).

## Status after the first cross-fixture benchmark rounds (2026-10-06)
- Registry holds five identities; the two Devstral generations are separate (`generation` field): Devstral Small 2505 (`huihui_ai/devstral-abliterated:24b`) and Devstral Small 2 2512 (`AliBilge/Huihui-Devstral-Small-2-24B-Instruct-2512-abliterated:q4_k_m`).
- Phase 9 wiring (`phase9.ts`): every real run emits a model event and a workflow event (`foundry:complete-feature-workflow`, task class `code_modification`); cost/tokens stay UNKNOWN. `cli p9-backfill <sinceIso>` ingests recorded runs idempotently.
- Scorecard (`scorecard.ts`, `cli scorecard`): per model/class/fixture, never a global rank.
- Routing (`routeFor`): complete_feature currently resolves to Devstral Small 2 with LOW confidence (1 completed full-score run); every other task class is NO_EVIDENCE.
- Evidence: `evidence/phase10/phase10-forge-small2-and-cross-fixture-final.md`, `phase10-cross-fixture-analysis.md`, `phase10-learning-proof.md`.

## Learning retry on the original route lesson (2026-10-08, engine 5fdb6cfdc6b7)
- Lesson `lesson-741735f18750` (ROUTE_ORDER) was verified intact against its source runs (read-all failed with 400, 400, 404 in three alert runs). Caveat: in the 404 run the model's own diagnosis blamed an incomplete `markAllRead`, so the route-order cause is the lesson author's inference.
- Fresh 3 BEFORE / 3 AFTER on the ticket fixture. Verdict: **NARROW_EFFECT**.
  - BEFORE: 2/3 workflow completions, both WITH_QUARANTINE, 0 clean. AFTER: 2/3, both WITH_QUARANTINE, 0 clean.
  - The lesson changed the first draft: wrong route ordering BEFORE 3/3, AFTER 0/3.
  - No outcome-level gain: clean completions, verifier outcome, calls (52 vs 49) and repairs (15 vs 14) are not materially different; AFTER was slower overall (3283s vs 2687s). The structural route repair fixes the same failure in one deterministic step, so the lesson is largely redundant at outcome level.
  - The lesson remains **UNVALIDATED**. The emergency fallback lesson was not used or promoted.
- Phase 9 backfill of these runs: 0 inserted, 12 duplicates, 0 rejected (already emitted at run time; idempotent).
- Forge: 6 runs, 67% nominal WORKFLOW_COMPLETED, 67% VERIFIER_PASS; all four nominal completions had quarantined tests. Clean completion stays distinct from quarantined completion.
- Evidence: `p10-evidence/learning-original-retry/` (local).

## Round 13 reliability gate (2026-10-09, engine 5fdb6cfdc6b7)
- chat x3, task x3, alert x3. **CLEAN 1/9** (task 2), WITH_QUARANTINE 7, UNVERIFIED 0, FAILED 1 (alert 1: 300s model-call timeout in the test stage). Independent VERIFIER_PASS 9/9. Gate (>=5/9 clean) not met: **PHASE_10_PARTIAL**.
- Round 12 was nominal 3/9, proven clean 0/9. Alert route-order failures stay eliminated: the engine's structural route repair fired in 3/3 alert runs and none failed on route order.
- Remaining blocker: the product code verifies in every run; the model's own tests keep violating the contract and are quarantined (0-15 tests per run). 123B: not justified.
- Evidence: `p10-evidence/round13/` (local).

## Architecture direction (unchanged)
Council reasons about the goal and sends a clear build request to Foundry. Foundry plans against the actual War Room code, asks Model Forge (`routeFor`) for an evidence-based coding model, builds, tests, repairs, validates and returns the result. HVS requests engineering work through Foundry and uses separate media-generation models for image/video/voice; coding models are never used as media models. Model Forge only supplies recommendations; Foundry's governance (Commander approval, limits) is unchanged.

## Gold standard: 9/9 CLEAN (Commander decision 2026-10-12; evidence local in `p10-evidence/`)
The completion standard is 9/9 CLEAN_LOCAL_ONLY (chat x3, task x3, alert x3), then an identical confirmation round on the same frozen engine. 5/9 (round-firstpass-final, engine e842da06) met the earlier gate only.
- Independent review of e842da06: REVIEW_FAIL (preflight could delete outside its sandbox from a `..` default path; a root-level default path crashed the process). Fixed in 01d2b639 with regression tests.
- Gold round 1 (01d2b639) 6/9, round 2 (dd215403) 8/9, round 3 (5a43796c) 7/9, round 4 (e24290f7) 6/9 (diagnostic only: source files were edited while it ran, though no run loaded them).
- Causes found and fixed (each with a regression test, validate:agent-eng-firstpass): string ids inherited from the existing code (chat), edit result that does not parse falls back to a whole-file reply, routes written as string RegExp, list-filter tests generated from the contract, helper models unload after use, streamed generation with runaway-loop detection and a changed retry, content type passed to readFileSync as its encoding (3 of the 3 round-4 failures).
- Known limits: generated code runs with the user's privileges and no OS-level isolation (same posture as the existing test runner); the assignment runtime ceiling is 30 minutes.

## Phase 10 closure (2026-10-13)
- 9/9 standard met on engine `d79a303707f1`: gold round 10 and the identical confirmation round were both 9/9 CLEAN_LOCAL_ONLY (18 of 18), frozen SHA and tree, clean tree, no mid-round edits. Two earlier SHAs reached 9/9 and failed confirmation (8/9) and were fixed.
- Versioned installed runtime `war-room-os-0.2.0-d79a3037-phase10-gold`: sandbox enabled (`chrome-sandbox` root:root 4755), installed acceptance with stated limitations, mission-store hashes unchanged, canonical launcher not repointed.
- Independent reviews: e842da06 REVIEW_FAIL (two blockers, fixed); d79a3037 and the installed evidence PHASE10_REVIEW_PASS_WITH_LIMITATIONS (no HIGH).
- Full receipt, limitations and landing plan: `docs/phases/PHASE_10_FINAL_RECEIPT.md`. The engine runs through the CLI harness; the installed app is the control plane.
