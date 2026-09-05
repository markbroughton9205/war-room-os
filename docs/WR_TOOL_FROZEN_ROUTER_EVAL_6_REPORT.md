# WR-TOOL FROZEN ROUTER EVAL-6 REPORT

Identity: `WR-TOOL-FROZEN-ROUTER-EVAL-6-001`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-FROZEN-ROUTER-EVAL-6-001/`

**WR-TOOL FROZEN NATIVE ROUTER + EVAL-6 — PASS** (mission completed; RED-X reproduced; exam run)  
**WR-TOOL FROZEN ROUTER — SEMANTIC ROUTING NOT DEMONSTRATED**  
**WR-TOOL FROZEN ROUTER — NOT READY FOR PROMOTION REVIEW**

No WRIM training. No LoRA. No EXP006. No promotion. Production untouched.

## Locked question

On a benchmark with lexical shortcuts controlled, does WRIM's mid-layer representation close the gap with BoW?

## EVAL-6 test (n=112)

| System | Acc | Bal | Macro F1 |
| --- | --- | --- | --- |
| Majority | 0.339 | 0.167 | 0.084 |
| Random | 0.143 | 0.138 | 0.135 |
| Keyword | 0.348 | 0.229 | 0.198 |
| Schema/rule | 0.339 | 0.167 | 0.084 |
| Registry lexical | 0.384 | 0.292 | 0.294 |
| Registry TF-IDF | 0.321 | 0.311 | 0.276 |
| Compact TOOL= parser | 0.339 | 0.167 | 0.084 |
| BoW (V5-style, V5 train) | **0.795** | **0.793** | **0.783** |
| Frozen WRIM L10 mean logistic | **0.491** | **0.483** | **0.470** |

WRIM − BoW balanced: **−0.310**.

RED-X EVAL-5 comparison: WRIM 0.771 / BoW 0.944. On EVAL-6 BoW dropped (~0.94 → 0.79) while WRIM dropped harder (~0.77 → 0.48).

## WRIM per-class recall (test)

| Class | Recall |
| --- | --- |
| NO_TOOL | 0.474 |
| WEB | 0.333 |
| MEMORY | 0.562 |
| FILES | 0.429 |
| RESEARCH | 0.765 |
| SHA256 | 0.333 |

TOOL-vs-NO_TOOL: 0.741. Conditional tool-ID: 0.50. Hard-boundary accuracy: 0.491.

## Semantic pair metrics

Matched-pair consistency: **0.161**  
Counterfactual flip accuracy: **0.161** (56 test pairs)  
Multi-turn / information-state accuracy: **0.071** (n=14)  
Lexical-adversarial: WRIM **0.50** vs BoW **0.75** vs keyword **0.33**

## Confidence / abstention (design only)

Correct top-1 mean 0.874 vs incorrect 0.757. Best margin threshold 0.851, coverage 0.509, selective accuracy 0.649. Not production-enabled.

## Interpretation: RESULT E

BoW is moderate (0.79, not ≥0.90). WRIM is below 0.60. Fine-grained semantic routing remains weak **despite** correct RED-X extraction. Representation limits are more plausible than a last-token readout bug.

BoW did not stay at EVAL-5 0.94, so lexical controls were not a total failure (RESULT A does not apply). WRIM did not stay in 0.70–0.80 (RESULT B does not apply). WRIM did not beat BoW (RESULT C does not apply). Neither collapsed to chance (RESULT D does not apply).

## Promotion gates (not lowered)

1. RED-X reproduction PASS  
2. EVAL-6 quality audit PASS  
3. WRIM bal above majority/keyword/schema: PASS (0.483 > 0.167/0.229/0.167)  
4. Matched-pair ≥0.70: FAIL  
5. Counterfactual ≥0.70: FAIL  
6. Hard-boundary ≥0.70: FAIL  
7. No class recall <0.50: FAIL  
8. Shadow supports offline: PASS (agreement = offline acc)  
9. Core diff 0: PASS  
10. No production behavior changes: PASS  

Not eligible for promotion review.

## Next

Do not promote the frozen L10 head. Do not train WRIM/LoRA. Do not start EXP006. Keep BoW as the strong lexical baseline. Frozen L10 head stays SHADOW diagnostic only. Native Router V1 (`WR-NATIVE-ROUTER-V1-CANDIDATE`) later used this head as one separable signal; EVAL-6 historical frozen-WRIM numbers above are unchanged.

