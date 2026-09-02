# Native Router V1 — CANDIDATE Lifecycle Promotion Report

**WAR ROOM NATIVE ROUTER V1 CANDIDATE PROMOTION — PASS**  
**NATIVE ROUTER V1 — PROMOTED TO CANDIDATE**  
**NATIVE ROUTER V1 — NOT SERVING (lifecycle)**  
**Later mission:** controlled single-tool serving pilot is a separate serving state. Lifecycle remains CANDIDATE. See `docs/WR_NATIVE_ROUTER_V1_CONTROLLED_PILOT_REPORT.md`.  
**NATIVE ROUTER V1 — MULTI-TOOL BLOCKED**

This mission promoted lifecycle metadata only. It did not deploy, enable serving, enable Node01 flags, train WRIM or LoRA, start EXP006, run RED-X-2, build a planner, enable multi-tool execution, apply R03 remediation, or commit git.

## Identity

| Field | Value |
|---|---|
| Promoted artifact | `WR-NATIVE-ROUTER-V1-CANDIDATE` |
| Previous lifecycle | SHADOW |
| New lifecycle | CANDIDATE |
| Scope | SINGLE_TOOL_ROUTING_ONLY |
| Promotion record | `model-lab/manifests/wr_tool_experiments/WR-NATIVE-ROUTER-V1-CANDIDATE-PROMOTION/` |
| Frozen baseline | `WR-NATIVE-ROUTER-V1-FROZEN-GENERALIZATION-BASELINE` |
| Fresh exam | `WR-NATIVE-ROUTER-V1-FRESH-GENERALIZATION-001` |

CANDIDATE does **not** mean production active. Serving activation remains OFF. Production feature flag remains OFF. Node01 is unchanged. Live tool routing remains `routeToolIntent` / `executeNormalizedRequest`.

## Bound hashes (exact)

| Item | Hash |
|---|---|
| Baseline | `8ceae5c75bbbc01c62631e88f4e82ae2bcea2cef9033f1ed94ac07c3928c6f2d` |
| Deterministic rules | `2030538c5974dc8db61dc961fd88ee0113765c4d85884714323f43b694548da4` |
| Lexical model | `9b386e93bbc4481fba834077a417a2cbc8fb16dad41fb992a4db5dfae2d2b8f6` |
| Confidence policy | `1992679c7921b8fae6d6f657d89ff9b48d0714cb4bc0255c8493d9bd02fce741` |
| Registry binding | `37429d94ac5aff98a806f08984f40b4dada698f08defd4b8e3f596b12febaca7` |
| Router source | `aff133438870a6de68d2675c8be8e86648a0fe0b3a6949ef3de880c0182ca842` |
| WRIM-0 | `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015` |

## Serving policy (candidate, not attached)

INFORMATION STATE → DETERMINISTIC HIGH-CONFIDENCE ROUTING → LEXICAL FALLBACK → REGISTRY / SCHEMA VALIDATION → CONFIDENCE / ABSTENTION → SINGLE TOOL ROUTE.

WRIM-L10: telemetry only (optional / development). Not part of serving decision policy.

Allowed routes: NO_TOOL, WEB, MEMORY, FILES, RESEARCH, SHA256. Unknown capability: ABSTAIN / NO_COMPATIBLE_TOOL. Multi-tool: diagnostic only / BLOCKED. Planner: BLOCKED.

## Evidence used (not re-run)

Fresh adjudicated 836; six-way 768. Serving-candidate balanced accuracy **0.979**, macro F1 **0.980**, information-state **0.985**, multi-turn **0.881**, matched-pair **0.956**, wrong-confident **0.014**. REAL_RUNTIME_FRESH **0**. This is acceptable for CANDIDATE lifecycle and is **not** sufficient for unrestricted production activation.

## What did not change

- Frozen router Python (`native_router_v1.py`) source hash unchanged
- Ten rules, lexical npz, confidence thresholds, registry bindings unchanged
- `WR_NATIVE_ROUTER_V1_SHADOW` default OFF; production `NODE_ENV` hard-off
- `active_modules` remain `[]` (lifecycle is not stored by stuffing ACTIVE)
- 17 POST_TEST_REMEDIATION_CANDIDATE items preserved, **0 applied**; R03 fresh precision **0.848** unchanged
- WRIM hash before = after; no WRIM/LoRA training; no EXP006; no RED-X-2
- Production `/Users/markbroughton/WarRoomNode01` not modified
- Git: inspect only; HEAD unchanged; no commit; no push

## Rollback (defined, not executed)

Command: `.venv-wrim/bin/python scripts/wrim-modular/native_router_v1_candidate_lifecycle.py --rollback-to-shadow`  
Function: `rollback_candidate_to_shadow` in `scripts/wrim-modular/native_router_v1_candidate_lifecycle.py`  
Restores lifecycle metadata CANDIDATE → SHADOW. Does not touch WRIM, production, historical evidence, or delete artifacts.

## Controlled pilot (design only, not activated)

Future separately authorized pilot must be single-tool, reversible, feature-gated, limited-scope, with fallback to the existing router, multi-tool blocked, WRIM-L10 excluded from serving, observer enabled, and immediate rollback. No automatic production rollout percentage was chosen.

## Validators

| Validator | Result |
|---|---|
| `prove_native_router_v1_candidate_promotion.py` | 36/36 PASS |
| `prove_native_router_v1.py` | 46/46 PASS |
| `prove_native_router_v1_fresh_generalization.py` | 41/41 PASS |
| `nativeRouterV1Shadow.validation.ts` | 8/8 PASS |
| `nativeRouterV1CandidatePromotion.validation.ts` | 10/10 PASS |

## Immutability

`WR-NATIVE-ROUTER-V1-CANDIDATE` is now an immutable evidence-backed V1. Future rule/lexical/threshold/scope edits require Native Router V1.x or V2. Do not mutate this candidate in place.

## Next recommendation

Do **not** treat CANDIDATE as unrestricted production. The separately authorized controlled single-tool serving pilot (`WR_NATIVE_ROUTER_V1_PILOT`) is now the bounded serving state. Lifecycle remains CANDIDATE. Kill switch: `WR_NATIVE_ROUTER_V1_PILOT=0`. R03 remediation remains backlog for a new version.
