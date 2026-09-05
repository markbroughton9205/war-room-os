# Native Router V1 Fresh Generalization Report

Frozen baseline: `WR-NATIVE-ROUTER-V1-FROZEN-GENERALIZATION-BASELINE`  
Exam: `WR-NATIVE-ROUTER-V1-FRESH-GENERALIZATION-001`  
Serving candidate: information-state + deterministic + lexical + registry/schema + abstention  
WRIM-L10: telemetry only. Multi-tool: diagnostic only. Flag `WR_NATIVE_ROUTER_V1_SHADOW` default OFF.

**WAR ROOM NATIVE ROUTER V1 FRESH GENERALIZATION — PASS**  
**NATIVE ROUTER V1 — FRESH GENERALIZATION DEMONSTRATED**  
**NATIVE ROUTER V1 — READY FOR CONTROLLED CANDIDATE PROMOTION REVIEW**  
**NATIVE ROUTER V1 — MULTI-TOOL NOT READY**

Not promoted at exam close. Not deployed. Production untouched. Git not committed.

## CANDIDATE lifecycle (later authorization; scientific numbers above unchanged)

Commander later authorized SHADOW → CANDIDATE for single-tool routing metadata only. Serving remains OFF. Multi-tool remains BLOCKED. REAL_RUNTIME_FRESH remains 0. See `docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_REPORT.md` and `docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_PACKET.md`.

## Freeze integrity

| Item | Value |
|---|---|
| Artifact hash | `8ceae5c75bbbc01c62631e88f4e82ae2bcea2cef9033f1ed94ac07c3928c6f2d` |
| Rule hash | `2030538c5974dc8db61dc961fd88ee0113765c4d85884714323f43b694548da4` |
| Lexical npz hash | `9b386e93bbc4481fba834077a417a2cbc8fb16dad41fb992a4db5dfae2d2b8f6` |
| Confidence policy hash | `1992679c7921b8fae6d6f657d89ff9b48d0714cb4bc0255c8493d9bd02fce741` |
| Registry snapshot hash | `37429d94ac5aff98a806f08984f40b4dada698f08defd4b8e3f596b12febaca7` |
| WRIM-0 | `d1affa…ba015` unchanged, `max_abs_diff=0` |
| Router source | `aff13343…2ca842` before = after |

Validator `prove_native_router_v1_fresh_generalization.py`: **41/41 PASS**.

## Corpus (honest provenance)

Adjudicated **836** items. Six-way scored **768**. Ambiguous **24**. Unknown **24**. Multi-tool diagnostic **20**.

| Provenance | Count | Notes |
|---|---|---|
| REAL_RUNTIME_FRESH | 0 | V5/EVAL pools already used; not relabeled as runtime |
| REAL_TEST_FRESH | 12 | Compact `TOOL=` development fixtures |
| HUMAN_ADJUDICATED_FRESH | 654 | Fresh domains, gold before scoring |
| ADV_TEST_FRESH | 170 | Traps, lexical adversaries, distractors, unknown, multi-tool |

Six-way gold: NO_TOOL 212, WEB 170, MEMORY 128, FILES 86, RESEARCH 86, SHA256 86. No overlap with V5 / EVAL-4 / EVAL-5 / EVAL-6 exact strings.

## Staged serving-candidate results

| Stage | n | Balanced acc | Verdict |
|---|---|---|---|
| A | 200 | 0.990 | CONTINUE |
| B | 500 | 0.980 | PASS_GATES |
| C | 768 (1000 not reached) | 0.979 | NOT_REACHED_1000; full set scored |

## Full six-way serving candidate (n=768)

| Metric | Value |
|---|---|
| Accuracy | 0.978 |
| Balanced accuracy | **0.979** |
| Macro F1 | **0.980** |
| TOOL-vs-NO_TOOL | **0.979** |
| Conditional tool-ID | **0.982** |
| NO_TOOL recall | 0.967 |
| WEB recall | 1.000 |
| MEMORY recall | 0.953 |
| FILES recall | 0.977 |
| RESEARCH recall | 1.000 |
| SHA256 recall | 0.977 |

EVAL-6 hybrid balanced accuracy was 0.978. Fresh serving-candidate balanced accuracy is **0.979**. EVAL-6-level six-way performance **generalized** on this frozen exam (human-authored + compact test; not live runtime).

## Generalization subsets (serving candidate)

| Slice | n | Accuracy |
|---|---|---|
| Fresh human-adjudicated | 630 | 0.983 |
| Fresh ADV six-way | 126 | 1.000 |
| REAL_TEST compact TOOL= | 12 | 0.500 |
| Natural paraphrase | 588 | 0.998 |
| Multi-turn | 84 | **0.881** |
| Information-state labels | 756 | **0.985** |
| Lexical-adversarial | 126 | 1.000 |
| NO_TOOL trap | 126 | 1.000 |
| WEB vs RESEARCH | 168 | 1.000 |
| MEMORY vs FILES | 126 | 0.992 |
| MEMORY vs NO_TOOL (current vs memory) | 84 | 0.964 |
| SHA256 vs NO_TOOL | 126 | 1.000 |
| Registry distractor | 42 | 1.000 |
| Unknown abstention (NO_COMPATIBLE_TOOL) | 24 | **1.000** |
| Matched-pair both-correct | 252 pairs | **0.956** |
| Counterfactual flip | 252 pairs | **0.956** |

Compact `TOOL=` protocol is a genuine miss lane (0.50) and was not relabeled to match the router.

## Ablations (balanced accuracy, frozen)

| System | Bal acc |
|---|---|
| Deterministic only | 0.979 |
| Lexical only | 0.771 |
| Det + lexical | 0.979 |
| Serving candidate (no WRIM) | **0.979** |
| WRIM telemetry only | 0.488 |
| Serving + WRIM hypothetical | 0.979 |

Lexical-only 0.771 vs EVAL-6 BoW 0.793: **mild drop, not collapse**. WRIM-only 0.488 matches the EVAL-6 WRIM failure mode. WRIM adds **no** serving-candidate lift.

## Rule dependence and overfit

97.3% of correct six-way routes are solved by deterministic high-confidence rules. 0.5% require lexical fallback. 1.0% abstain. 27.1% of the set would fail without the rules (lexical-only would miss them).

This is **state-template generalization** (new domains, same information-state semantics), not a WRIM semantic leap. It is not “the rules only match EVAL-6 sentences”: paraphrases and new nouns still fire. It **is** highly rule-dependent.

| Rule | Fresh triggers | Precision when first |
|---|---|---|
| R01 supplied-context negation | 84 | **1.000** (highest; ties with several 1.0 rules) |
| R03 prior-turn underspecified | 46 | **0.848** (lowest) |
| R02 prior-turn concrete | 38 | 0.921 |
| R08 fresh public lookup | 254 (often non-first) | 1.000 when first |

Largest miss family: **RULE_GENERALIZATION** (17 POST_TEST_REMEDIATION_CANDIDATE items, **not applied**). Typical miss: multi-turn “we locked {item} at {spelled-out value}” treated as underspecified MEMORY because `CONCRETE_VALUE` requires a digit.

Lexical overfit: **not indicated** as a serving failure (adversaries 1.0; lexical-only only slightly below EVAL-6).

State-aware routing: **generalized** (info-state 0.985; multi-turn 0.881 ≥ 0.85 gate).

## Confidence / abstention (thresholds not tuned on this set)

Wrong-confident rate **0.014** (gate ≤ 0.05). Coverage 0.990. Selective accuracy at 100% = 0.978; at 95% = 0.986. Confidence correct mean 0.926 vs incorrect 0.691. Component disagreement 0.276 (lexical often disagrees; deterministic still wins).

## Registry growth (shadow, existing cards + analysis-only clones)

6 / 10 / 20 / all-8: top-1 accuracy **0.978**, route stability **1.000**. No invented production tools.

## Multi-tool diagnostic (not in promotion gates)

n=20. Recall **0.75** (historical 0.40 improved). Precision vs six-way negatives 1.0. Exact family-set 0.75. False single-route collapse 0.25. No planner. No execution. **Not ready.**

## Locked gates (full n=768)

All ten review gates **PASS**. Ready for **controlled CANDIDATE promotion review** only. Not unrestricted production, not multi-tool, not planner, not autonomous execution.

## Next recommendation

Present the CANDIDATE promotion packet to Commander. Do not enable `WR_NATIVE_ROUTER_V1_SHADOW` in production. Do not train WRIM/LoRA. Do not start EXP006. Optional later (after this exam is closed): POST_TEST_REMEDIATION on R03 spelled-out quantities — not in this mission.

## Later CANDIDATE promotion (metadata only)

Lifecycle is now CANDIDATE. Serving was not activated. The 17 POST_TEST_REMEDIATION_CANDIDATE items, including R03, were not applied. Frozen hashes are unchanged.
