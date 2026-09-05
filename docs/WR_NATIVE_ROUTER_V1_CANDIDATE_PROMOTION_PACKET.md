# Native Router V1 — Controlled CANDIDATE Promotion Packet

**Authorized CANDIDATE lifecycle. Serving remains OFF. Not a deploy order.**

From: `SHADOW`  
To: `CANDIDATE` (single-tool routing review only)  
Identity: `WR-NATIVE-ROUTER-V1-CANDIDATE`  
Frozen exam: `WR-NATIVE-ROUTER-V1-FROZEN-GENERALIZATION-BASELINE` / `WR-NATIVE-ROUTER-V1-FRESH-GENERALIZATION-001`  
Promotion record: `model-lab/manifests/wr_tool_experiments/WR-NATIVE-ROUTER-V1-CANDIDATE-PROMOTION/`  
Report: `docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_REPORT.md`

Commander authorization for this lifecycle step: **YES** (controlled CANDIDATE promotion mission). Production activation: **NO**. Serving activation: **NO**.

This packet does **not** authorize production deployment, multi-tool execution, planner use, or autonomous tool calls.

## Serving policy (CANDIDATE, not attached)

INFORMATION STATE → DETERMINISTIC HIGH-CONFIDENCE ROUTING → LEXICAL FALLBACK → REGISTRY/SCHEMA VALIDATION → CONFIDENCE/ABSTENTION → SINGLE TOOL ROUTE.

WRIM-L10 stays **telemetry only** (optional / development). Multi-tool stays **blocked / diagnostic**. Integer EVAL-6 ids remain compatibility only.

## Feature flag

`WR_NATIVE_ROUTER_V1_SHADOW` remains the only wiring flag today. It is **default OFF**. Production `NODE_ENV === 'production'` is hard-off.

CANDIDATE lifecycle must **not** flip this flag on Node01. A future serving attach would need a new, explicit flag and a second authorization. Until then, `routeToolIntent` / `executeNormalizedRequest` stay authoritative.

## Scope

- In: six-way single-route decisions: NO_TOOL, WEB, MEMORY, FILES, RESEARCH, SHA256
- Out: multi-tool plans, unknown capabilities as forced six-way labels, payment/routing numbers, production traffic

Unknown capability: ABSTAIN / `NO_COMPATIBLE_TOOL`.

## Excluded capabilities

Fax, SMS, email, calendar, card-charge, badge-bypass, production restart, Cloudflare change, spectrophotometer, and any tool not in `lib/tools/toolRegistry.ts` plus gym SHA256. Correct CANDIDATE behavior is abstention (`NO_COMPATIBLE_TOOL` / insufficient / ambiguous), not a confident supported tool.

## Abstention fallback

If `abstain_state` is not `ROUTE_CONFIDENT` or `NO_TOOL_CONFIDENT`, keep the **current** `toolRouter` decision. Native Router V1 must not execute.

## Multi-tool block

`multi_tool_required` must not dispatch tools. No planner. Historical detector recall 0.40 → fresh diagnostic 0.75 is **not** promotion of multi-tool.

## Telemetry / monitoring (development)

Reuse `captureRuntimeTrajectory` + `nativeRouterV1FieldsForProvenance`. No parallel ledger. Log predicted vs current route, gate, information-state, disagreement, abstain, confidence/margin. Serving latency must exclude WRIM extract. WRIM-L10 routing head is **not** promoted.

## Rollback

Defined, not executed in the promotion mission.

1. `.venv-wrim/bin/python scripts/wrim-modular/native_router_v1_candidate_lifecycle.py --rollback-to-shadow`
2. Function `rollback_candidate_to_shadow` restores lifecycle metadata CANDIDATE → SHADOW.
3. Leave `WR_NATIVE_ROUTER_V1_SHADOW` unset / off.
4. Do not attach Native Router V1 as an ACTIVE modular-intelligence module (`active_modules` stays `[]`).
5. Frozen baseline hashes remain the rollback snapshot; do not hot-edit rules; do not delete evidence.

## Evidence (frozen exam)

Fresh six-way n=768: balanced accuracy 0.979, macro F1 0.980, min recall 0.953 (MEMORY), TOOL-vs-NO_TOOL 0.979, conditional tool-ID 0.982, information-state 0.985, multi-turn 0.881, lexical-adversarial 1.000, unknown abstention 1.000, wrong-confident 0.014. All locked review gates passed. Integrity proof `max_abs_diff=0`. REAL_RUNTIME_FRESH=0.

## Bound hashes

Baseline `8ceae5c75bbbc01c62631e88f4e82ae2bcea2cef9033f1ed94ac07c3928c6f2d`  
Rules `2030538c5974dc8db61dc961fd88ee0113765c4d85884714323f43b694548da4`  
Lexical `9b386e93bbc4481fba834077a417a2cbc8fb16dad41fb992a4db5dfae2d2b8f6`  
Confidence `1992679c7921b8fae6d6f657d89ff9b48d0714cb4bc0255c8493d9bd02fce741`  
Registry `37429d94ac5aff98a806f08984f40b4dada698f08defd4b8e3f596b12febaca7`  
Router source `aff133438870a6de68d2675c8be8e86648a0fe0b3a6949ef3de880c0182ca842`

## Immutability

This V1 candidate is immutable. Future edits require Native Router V1.x or V2. Seventeen POST_TEST_REMEDIATION_CANDIDATE items (including R03 spelled-out quantities, fresh precision 0.848) remain backlog and were not applied.

## Live-runtime gap

REAL_RUNTIME_FRESH = 0. CANDIDATE promotion is based on fresh human-adjudicated, adversarial, and real-test evidence. That is acceptable for CANDIDATE. It is not sufficient by itself for unrestricted production activation.

## Controlled serving pilot (design only)

Not activated. Commander must authorize a future single-tool, reversible, feature-gated, limited-scope pilot with existing-router fallback, multi-tool blocked, WRIM-L10 excluded from serving, observer enabled, and immediate rollback. No automatic production percentage is chosen here.

## Commander status

**CANDIDATE lifecycle authorized.** Serving remains OFF. Do not treat this packet as a deploy order.
