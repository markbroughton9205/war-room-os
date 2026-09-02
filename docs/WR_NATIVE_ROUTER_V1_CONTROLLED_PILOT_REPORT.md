# Native Router V1 — Controlled Single-Tool Serving Pilot Report

**WAR ROOM NATIVE ROUTER V1 CONTROLLED PILOT — PASS**  
**NATIVE ROUTER V1 — CONTROLLED SINGLE-TOOL PILOT ACTIVE**  
**NATIVE ROUTER V1 — CANDIDATE**  
**NATIVE ROUTER V1 — MULTI-TOOL BLOCKED**

Pilot artifact: `WR-NATIVE-ROUTER-V1-CONTROLLED-PILOT-001`  
Candidate: `WR-NATIVE-ROUTER-V1-CANDIDATE` (lifecycle unchanged)  
Flag: `WR_NATIVE_ROUTER_V1_PILOT` default OFF; Node01 **ON**

## What was authorized and done

Controlled, reversible, single-tool serving attach of the frozen candidate. Existing `routeToolIntent` remains fallback. Existing `executeNormalizedRequest` remains the tool executor. Chat live research still executes through `runLiveResearchRouter` (not a second executor). WRIM-L10 is not in the serving decision (`full` mode with `wrim_proba=None`). Multi-tool cannot chain. No planner. No WRIM/LoRA/EXP006/RED-X-2. R03 unchanged. 17-item remediation backlog unapplied.

## Hashes (unmodified)

| Item | Value |
|---|---|
| Baseline | `8ceae5c75bbbc01c62631e88f4e82ae2bcea2cef9033f1ed94ac07c3928c6f2d` |
| Router source | `aff133438870a6de68d2675c8be8e86648a0fe0b3a6949ef3de880c0182ca842` |
| Rules | `2030538c5974dc8db61dc961fd88ee0113765c4d85884714323f43b694548da4` |
| Lexical | `9b386e93bbc4481fba834077a417a2cbc8fb16dad41fb992a4db5dfae2d2b8f6` |
| Confidence | `1992679c7921b8fae6d6f657d89ff9b48d0714cb4bc0255c8493d9bd02fce741` |
| Registry | `37429d94ac5aff98a806f08984f40b4dada698f08defd4b8e3f596b12febaca7` |
| WRIM-0 | `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015` (before = after) |

## Development proof

`nativeRouterV1Pilot.validation.ts` 40/40. `prove_native_router_v1_controlled_pilot.py` 20/20. Shadow 8/8 and candidate-promotion 10/10 still PASS. `prove_native_router_v1.py` 46/46 PASS.

Live infer (not REAL_RUNTIME_FRESH): SHA256 and NO_TOOL and WEB confident; fax abstains `NO_COMPATIBLE_TOOL`; multi-tool `multi_tool_required` true and does not chain; underspecified FILES open can abstain and fall back.

## Node01

Minimal runtime files copied. Surgical hook in `app/api/chat/execute.ts`. Flag ON. Infer runs from the development worktree python/candidate. `pnpm run build` succeeded. `com.warroom.node01` restarted. localhost login 200; unauth APIs 401; warroomos.com login 200.

## Live-runtime evidence

REAL_RUNTIME_FRESH = **0**. Checkpoints 25/50/100 not reached. Collect genuine authenticated traffic next; do not auto-expand scope.

## Rollback (defined, not executed)

Unset or set `WR_NATIVE_ROUTER_V1_PILOT=0` and restart Node01 if env change requires it. Proven in development: flag OFF returns byte-equivalent `routeToolIntent` results.
