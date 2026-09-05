# War Room Native Router V1 Architecture

Identity: `WR-NATIVE-ROUTER-V1-CANDIDATE`  
Path: `model-lab/manifests/wr_tool_experiments/WR-NATIVE-ROUTER-V1-CANDIDATE/`  
Lifecycle: **CANDIDATE** (not ACTIVE, not production, not serving). Active modules remain `[]`.

This is a development candidate routing subsystem. It does not train WRIM, does not train LoRA, does not start EXP006, and does not execute tools. Serving activation is **OFF**.

## Existing stack (extended, not duplicated)

| Concern | Path |
|---|---|
| Compact parse → validate → normalize | `lib/modular-intelligence/toolRouter.ts` (`routeToolIntent`) |
| Execution boundary | `executeNormalizedRequest` (unchanged) |
| Authoritative UI registry | `lib/tools/toolRegistry.ts` |
| Schema view | `lib/modular-intelligence/toolCatalog.ts` |
| Trajectory observer | `lib/modular-intelligence/runtimeTrajectoryCapture.ts` → AGI experience via existing hooks |
| Frozen WRIM L10 head | `WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1` (`layers.10` mean, raw, L2 logistic) |
| Chat path | `app/api/chat/execute.ts` + `lib/context-assembler/assemble` (not replaced) |

No second registry. No parallel ledger. No replacement of War Room API execution.

## Contract

Input: request text, optional conversation/context flags derived from text, registry snapshot, optional frozen WRIM probability vector.

Output: decision, capability family, candidate tools, selected tool if confident, confidence, top1–top2 margin, reason codes, information-state, gate, abstention state, per-component predictions. Classifier does not execute.

Integer labels 0–5 exist only as EVAL-6 compatibility. Runtime keys are tool IDs / family strings.

## Information states

`ANSWERABLE_FROM_CONTEXT`, `DURABLE_MEMORY_REQUIRED`, `ARTIFACT_ACCESS_REQUIRED`, `CURRENT_EXTERNAL_INFORMATION_REQUIRED`, `MULTI_SOURCE_RESEARCH_REQUIRED`, `DETERMINISTIC_COMPUTE_REQUIRED`, `INSUFFICIENT_CONTEXT`, `AMBIGUOUS`.

## Gate states

`NO_TOOL_CONFIDENT`, `TOOL_REQUIRED_CONFIDENT`, `TOOL_OPTIONAL`, `AMBIGUOUS`, `INSUFFICIENT_CONTEXT`.

NO_TOOL is gated before exact-tool ranking. Exact-tool ranking does not force NO_TOOL to compete as just another class when the gate is TOOL_REQUIRED.

## Capability families

`INTERNAL_CONTEXT` → NO_TOOL  
`EXTERNAL_RETRIEVAL` → web  
`MEMORY_STATE` → memory  
`ARTIFACT_ACCESS` → files  
`RESEARCH_SYNTHESIS` → research  
`DETERMINISTIC_UTILITY` → sha256 (gym catalog, not TOOL_REGISTRY)

Registry also contains repo / deployments / build. Those cards are derived, not invented. Reliability, cost, freshness, and read/write are **unavailable** in current metadata.

## Hybrid policy (predeclared cascade)

1. Deterministic high-confidence rule wins when combined lexical + state + context conditions fire (not a single keyword).
2. Else NO_TOOL vs TOOL_REQUIRED gate.
3. Else capability-family shortlist.
4. Lexical V5-style BoW ranking inside the shortlist.
5. Frozen WRIM L10 used only when lexical margin is low.
6. Schema/availability check (required args expressible; tool available).
7. Confidence / abstention recorded. No execution.

Weights were not fit on EVAL-6 test.

## Fresh generalization freeze (historical addendum)

Exam `WR-NATIVE-ROUTER-V1-FRESH-GENERALIZATION-001` froze this candidate as `WR-NATIVE-ROUTER-V1-FROZEN-GENERALIZATION-BASELINE` (rule hash `2030538c…548da4`, lexical npz `9b386e93…d2b8f6`). Serving policy for scoring was det+state+lexical+schema+abstention with WRIM telemetry skipped. Rules, thresholds, and lexical weights were not edited during the exam. See `docs/WR_NATIVE_ROUTER_V1_FRESH_GENERALIZATION_REPORT.md`. Lifecycle is now **CANDIDATE** after separate Commander authorization. Serving remains OFF.

## Feature flag

`WR_NATIVE_ROUTER_V1_SHADOW` default **OFF**. Production `NODE_ENV` always off. Shadow attaches provenance on the existing observer and never changes `routeToolIntent`. CANDIDATE lifecycle does not enable this flag.

## Promoted serving policy (metadata; not attached)

INFORMATION STATE → DETERMINISTIC HIGH-CONFIDENCE ROUTING → LEXICAL FALLBACK → REGISTRY/SCHEMA VALIDATION → CONFIDENCE/ABSTENTION → SINGLE TOOL ROUTE.

WRIM-L10 remains telemetry only. Multi-tool remains blocked. See `docs/WR_NATIVE_ROUTER_V1_CANDIDATE_PROMOTION_REPORT.md`.

## Code

- Python router: `scripts/wrim-modular/native_router_v1.py`
- EVAL-6 runner: `scripts/wrim-modular/run_native_router_v1.py`
- Fresh generalization runner: `scripts/wrim-modular/run_native_router_v1_fresh_generalization.py`
- Shadow infer: `scripts/wrim-modular/native_router_v1_infer.py`
- TS gate/score: `lib/modular-intelligence/nativeRouterV1Gate.ts`, `nativeRouterV1Shadow.ts`
