# WRIM-1 POST-TRAIN EVALUATION — WRIM1-RUN-000001

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Git: inspect only. No commit, push, merge, rebase, reset, stash, or clean.  
Identity: **WRIM-1 CANDIDATE** (not Ra’el, not AGI, not production, not active model)

## BINARY VERDICT

**WRIM-1 EVALUATION — PASS**

Evaluation executed on a verified reload of the official candidate. Comparison artifacts are stored. Results are trustworthy as a capability assessment.

**PASS does not mean promotion.** Official Wave 9 gate: **PROMOTION_REJECTED**.

WRIM-1 CANDIDATE — EVALUATED  
WRIM-1 PROMOTION — REJECTED  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

---

## 1. Final checkpoint integrity

**PASS.** `checkpoint-step-001893` manifest `complete=true`, `status=complete`, `corrupted` not set, `run_id=WRIM1-RUN-000001`, `promotable=false`, `test_only=false`.

All sidecar file SHA-256 values matched. Recomputed `model_tensor_sha256` matched the expected final SHA. Tokenizer / architecture / training-config / corpus identity hashes matched Wave 9 constants. Fresh-process `load_bundle` succeeded twice (evaluator + independent reload). Weights were not updated.

## 2. Final checkpoint SHA

`e70cc5d20e12566d242fab16205fee701703fe61bd9118e955dbd09559aba830`

## 3–4. Best candidate checkpoint / SHA

**Same as final:** step **1893**, SHA `e70cc5d20e12566d242fab16205fee701703fe61bd9118e955dbd09559aba830`.

Selection used **validation_loss on the checkpoint registry**, not held-out test. Registry diagnostic val at 1893 is **6.387651324272156**, lower than cadence checkpoints (next-best cadence val step 1200 = 6.3896788358688354). Held-out was run **once** on that selected checkpoint. The 10 complete checkpoints were not sweep-evaluated on held-out.

## 5–8. Held-out inventory

| Metric | Count |
|---|---|
| Eval items | **10** |
| Domains | **10** |
| Supported by WRIM runtime (`wrim0Support=SUPPORTED`) | **2** (language, structured JSON) |
| Unsupported | **8** (code, tool protocol, research, evidence, retrieval, contradiction, temporal, memory/project) |

Unsupported items were **not** converted to score 0.

## 9. Contamination result

**DISCLOSED — not clean generalization.**

Official Wave 8.1 `corpus-manifest.json` `leakage.passed=true` (fingerprint/lineage gates) is unchanged.

A train-shard **substring** recheck found held-out **prompt strings** inside materialized **eval-spec source** and prior eval reports:

- `lib/wrim1-dataset/heldOut.ts`
- `lib/wrim1-dataset/eval.ts`
- `lib/wrim1-dataset/behavior.ts`
- `model-lab/manifests/GENESIS_REPORT.md`
- `model-lab/manifests/wrim0_eval_results.json`

Fingerprint-hash collisions vs frozen `contaminationFingerprint` fields: **0**. Behavior-example lineage collisions: **0**.

Artifact: `model-lab/manifests/wrim1_checkpoints/held-out-contamination-recheck.json`.

Even with that leakage, WRIM-1 did **not** emit the expected JSON/literary completions; it collapsed to dots. Contamination does not excuse the collapse, and it **does** forbid claiming held-out success as unseen-task generalization.

## 10. WRIM-0 baseline source

**RECORDED_BASELINE** from `model-lab/manifests/wave8_1/wrim0-heldout-run.json` (parent SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`). WRIM-0 was **not** re-executed. No fabricated historical scores. WRIM-0 JSON/language rows have recorded text; they have **no numeric `score` field**. JSON probe historically failed parse (Genesis / Wave 8.1). Unsupported domains remain UNSUPPORTED.

## 11–12. WRIM-0 vs WRIM-1 (every item)

| eval_id | domain | scorer | WRIM-0 | WRIM-1 | delta | improved | regressed | unsupported | contamination |
|---|---|---|---|---|---|---|---|---|---|
| w81-eval-language-alice | language | qualitative + collapse | SUPPORTED; literary-ish continuation (RECORDED) | SUPPORTED; prompt echo + `.` collapse | n/a (no numeric LM grade) | no | **yes (collapse)** | no | eval-spec + Alice/Genesis prompt in train shards |
| w81-eval-json-schema | structured_output | json-validity | SUPPORTED; invalid JSON (RECORDED; historical parse fail) | score **0**; collapse | no numeric WRIM-0 score in file | no | **yes (collapse)** | no | `{"trainingStarted":` in `heldOut.ts` train chunk |
| w81-eval-code-protocol | code | unsupported-runtime | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec in train |
| w81-eval-tool-protocol | tool_use | tool-call-structure | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec in train |
| w81-eval-research-conflict | research | contradiction-preserved | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec in train |
| w81-eval-evidence-grounding | evidence_grounding | citation-evidence-match | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec in train |
| w81-eval-retrieval | retrieval_context | retrieval-target-match | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec in train |
| w81-eval-contradiction | contradiction_handling | claim-status | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec in train |
| w81-eval-temporal | temporal_reasoning | temporal-order | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec + terra example text in train |
| w81-eval-memory | memory_project_continuity | exact-string | UNSUPPORTED | UNSUPPORTED; echo+collapse | — | no | no | **yes** | eval-spec in train |

Artifact SHA-256 of `held-out-results.json`: `402a31b688a32d090d0aed1e7b612ded0d63e84a13019a60f610c5d4a814c255`.

## 13. Natural language

WRIM-1 output: ` Alice was beginning to................................................`  
valid decode: yes (UTF-8). Coherence: **fail**. Repetition: **collapsed** (`max_run=24`, unique ratio 0.179). Instruction adherence: not demonstrated. WRIM-0 recorded a short Alice-like paragraph (not collapsed).

## 14. JSON / structured output

Objective `json-validity`: **fail** (score 0). Output: ` {"trainingStarted":................................................`  
Not a parseable object. Required field `trainingStarted` boolean not produced. Extraneous: repeated `.`. WRIM-0 also failed JSON parse (RECORDED). WRIM-1 is **not** an improvement; collapse is a **critical regression** vs WRIM-0’s non-degenerate invalid JSON.

## 15. Code

**UNSUPPORTED** by WRIM runtime. Generated text is prompt echo + dots. Not Code Operator. Not executed.

## 16. Tool protocol

**UNSUPPORTED.** No bounded tool executor in this eval. Output is prompt echo + dots. No new external authority granted.

## 17. Research / evidence

**UNSUPPORTED.** No evidence-use, no contested-status language. Echo + collapse only. No new Internet research.

## 18. Contradiction

**UNSUPPORTED.** Did not say contested / no winner. Echo + collapse.

## 19. Temporal

**UNSUPPORTED.** Did not say `stale`. Not Terra sensor competence.

## 20. Context / retrieval

**UNSUPPORTED.** No supplied constitution excerpt was injected as a retrieval context in this generator path; the frozen item is a probe string. Output echo + collapse.

## 21. Other domains

Memory/project: **UNSUPPORTED.** Echo + collapse. Not a continuity runtime.

## 22–24. Aggregation

| | Count |
|---|---|
| Supported evals | 2 |
| Supported pass (objective) | **0** |
| Supported fail | **2** (JSON 0; language collapse) |
| Improvement count | **0** |
| Regression count | **2** (language, JSON — collapse) |
| Unchanged (unsupported) | **8** |
| Fake AGI/intelligence % | **not computed** |

Training loss 6.59 is **not** treated as success. Validation moved ~6.42 → ~6.39 while held-out generation collapsed. Loss ≠ capability.

## 25. Repetition / collapse

**CRITICAL.** All 10 generations collapse to long `.` runs after echoing the prompt. Empty generations: no. Invalid decode: no. NaN logits: not observed (greedy argmax completed). Degenerate loop: **yes**.

## 26. Memorization

No copy of WRIM-0’s Alice continuation. Pattern is **prompt echo + period collapse**, not hidden-answer dump. Combined with eval-spec strings in train shards, this is **not** evidence of useful memorization of held-out answers.

## 27. Validation-vs-test selection

Held-out used once on the **lowest validation_loss** registry checkpoint (1893). No held-out shopping across checkpoints.

## 28. Training status

**TRAINED** / 1893/1893. Attempt 1 FAIL preserved. Attempt 2 completed.

## 29. Production status

**UNCHANGED.** `/Users/markbroughton/WarRoomNode01` not touched. Council / Ra’el / production inference unchanged.

## 30. Promotion recommendation

**PROMOTION_REJECTED**  
Persisted: `model-lab/manifests/wave9/promotion-state.json` (`promoted: false`).

Reasons: supported-language collapse; JSON still invalid with collapse; zero improvements; eight domains remain unsupported; eval-spec contamination forbids generalization claims.

## 31. Exact next authorization required

A **separate Commander promotion instruction** would be required to change promotion state. **Do not promote on this evidence.** A later training run would require a **new run ID** if architecture/corpus/tokenizer/split change; this evaluation does not authorize retraining.

---

## Final stop states

WRIM-1 EVALUATION — PASS  
WRIM-1 CANDIDATE — EVALUATED  
WRIM-1 PROMOTION — REJECTED  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED
