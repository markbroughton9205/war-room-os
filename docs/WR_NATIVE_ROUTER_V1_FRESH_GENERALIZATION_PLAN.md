# Native Router V1 Fresh Generalization Plan

Identity: `WR-NATIVE-ROUTER-V1-FROZEN-GENERALIZATION-BASELINE` → exam `WR-NATIVE-ROUTER-V1-FRESH-GENERALIZATION-001`  
Lifecycle during test: **SHADOW**. Production `/Users/markbroughton/WarRoomNode01` is out of scope.

This plan was locked before scoring. Gates were not lowered after seeing results.

## Question

Does the frozen Native Router V1 serving candidate (information-state + deterministic pre-router + lexical fallback + registry/schema + abstention) generalize to fresh requests that were not used to design EVAL-6 or the ten rules?

WRIM-L10 remains telemetry. Multi-tool remains diagnostic. No planner. No execution. No WRIM/LoRA/EXP006/RED-X-2. No mid-test rule or threshold edits.

## Freeze (before any new labels)

Snapshot hashes of the ten rules, information-state logic, lexical BoW npz, confidence/abstention policy, registry bindings, and WRIM-0 weights. Identity `WR-NATIVE-ROUTER-V1-FROZEN-GENERALIZATION-BASELINE`.

## Data

Prefer unused real runtime. Existing trajectory pools were consumed by V5 / EVAL-4 / EVAL-5, so **REAL_RUNTIME_FRESH = 0** (honest). Compact `TOOL=` fixtures are **REAL_TEST_FRESH**. Remaining six-way items are **HUMAN_ADJUDICATED_FRESH** or **ADV_TEST_FRESH**. Gold is authored from War Room routing semantics before the frozen router is scored. Ambiguous / unknown / multi-tool stay in separate lanes.

Overlap with V5 train, EVAL-4, EVAL-5, and EVAL-6 is rejected at build time (normalized exact string).

## Stages

- A: 200 balanced six-way → CONTINUE or STOP
- B: 500 → recalculate locked gates
- C: 1000 if reached; otherwise score the full available six-way set without blocking analysis

## Locked promotion-review gates (six-way serving candidate)

| Gate | Threshold |
|---|---|
| Balanced accuracy | ≥ 0.90 |
| Macro F1 | ≥ 0.88 |
| Min class recall | ≥ 0.75 |
| TOOL-vs-NO_TOOL | ≥ 0.92 |
| Conditional tool-ID | ≥ 0.90 |
| Information-state accuracy | ≥ 0.90 |
| Multi-turn accuracy | ≥ 0.85 |
| Lexical-adversarial accuracy | ≥ 0.75 |
| Unknown/unsupported abstention | ≥ 0.85 |
| Wrong-confident rate | ≤ 0.05 |

Passing means **ready for controlled CANDIDATE promotion review**, not production deployment.

## Failure policy

If gates fail: freeze evidence, classify misses, return to Commander. Do not edit rules.

## Pass policy

If gates pass: emit `docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_PACKET.md`. Do not promote, deploy, or enable the flag in production.
