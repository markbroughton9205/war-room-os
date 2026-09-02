# War Room Native Router V1 EVAL-6 Report

Identity: `WR-NATIVE-ROUTER-V1-CANDIDATE`  
Artifact: `model-lab/manifests/wr_tool_experiments/WR-NATIVE-ROUTER-V1-CANDIDATE/`

**WAR ROOM NATIVE ROUTER V1 — PASS** (architecture + offline EVAL-6 ablation + development shadow proof)  
**WAR ROOM NATIVE ROUTER V1 — SEMANTIC ROUTING DEMONSTRATED** (state-aware switchboard, not WRIM-only)  
**WAR ROOM NATIVE ROUTER V1 — READY FOR PROMOTION REVIEW** (not promoted; SHADOW)

No WRIM training. No LoRA. No EXP006. EVAL-6 canonical rows unchanged. Gates locked on validation before test. Production untouched.

## EVAL-6 test (n=112)

| System | Acc | Bal | Macro F1 |
|---|---|---|---|
| Keyword | 0.348 | 0.229 | 0.198 |
| Schema/rule | 0.339 | 0.167 | 0.084 |
| BoW (V5-style, V5 train) | **0.795** | **0.793** | **0.783** |
| Frozen WRIM L10 mean | **0.491** | **0.483** | **0.470** |
| Deterministic only | 0.964 | 0.976 | 0.969 |
| Lexical only (same BoW) | 0.795 | 0.793 | 0.783 |
| WRIM only | 0.491 | 0.483 | 0.470 |
| Deterministic + lexical | 0.964 | 0.982 | 0.970 |
| Deterministic + WRIM | 0.929 | 0.958 | 0.934 |
| Lexical + WRIM | 0.670 | 0.664 | 0.647 |
| **Full hybrid V1** | **0.955** | **0.978** | **0.963** |

Hybrid − BoW balanced: **+0.185**. Hybrid − frozen WRIM balanced: **+0.495**.

Full hybrid is slightly below deterministic+lexical (0.978 vs 0.982 balanced) because WRIM/schema stages move a few NO_TOOL cases. WRIM is not the value source.

## Full hybrid per-class recall (test)

| Class | Recall |
|---|---|
| NO_TOOL | 0.868 |
| WEB | 1.000 |
| MEMORY | 1.000 |
| FILES | 1.000 |
| RESEARCH | 1.000 |
| SHA256 | 1.000 |

TOOL-vs-NO_TOOL: **0.955**. Conditional tool-ID: **1.000**.

## Semantic subsets (primary)

| Metric | Hybrid | BoW | Frozen WRIM |
|---|---|---|---|
| Matched-pair consistency | **0.911** | 0.643 | (historical 0.161) |
| Counterfactual flip | **0.911** | 0.643 | (historical 0.161) |
| Hard-boundary accuracy | **0.955** | — | 0.491 |
| Information-state | **1.000** | 0.500 | 0.071 |
| Multi-turn | **1.000** | 0.500 | 0.071 |
| Lexical-adversarial | **0.75** | **0.75** | 0.50 |

Hybrid does **not** merely reproduce BoW on matched pairs / information-state / multi-turn. Lexical-adversarial is unchanged vs BoW (0.75). Gain is **state-aware deterministic routing**, not WRIM mid-layer semantics.

## Ablation conclusion

Most value: information-state + deterministic pre-router.  
Least value: frozen WRIM on top of det+lexical (slightly negative vs D).  
Abstention: coverage 0.902, selective accuracy 0.970 vs overall 0.955 (small selective lift). Diagnostic abstention 11/12. Multi-tool diagnostic 4/10 (detector only; no planner).

## Promotion gates (locked before test; not lowered)

All preferred minima met on EVAL-6 test. Lifecycle remains SHADOW. Do not deploy production. Do not attach as ACTIVE module.

## Core

SHA `d1affa…ba015`. Tree `8d0c903…678b9`. `max_abs_diff=0`. Trainable WRIM params 0.

## Fresh generalization (later exam; EVAL-6 numbers above unchanged)

Frozen baseline `WR-NATIVE-ROUTER-V1-FROZEN-GENERALIZATION-BASELINE`. Fresh six-way n=768 serving-candidate balanced accuracy **0.979**, macro F1 **0.980**, matched-pair **0.956**. Locked review gates PASS. REAL_RUNTIME_FRESH=0 (honest). Compact TOOL= REAL_TEST_FRESH accuracy 0.50. Multi-tool diagnostic recall 0.75 (not ready). See `docs/WR_NATIVE_ROUTER_V1_FRESH_GENERALIZATION_REPORT.md` and `docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_PACKET.md`. EVAL-6 numbers in this report are unchanged. A later mission promoted lifecycle **SHADOW → CANDIDATE** without serving or production activation.
