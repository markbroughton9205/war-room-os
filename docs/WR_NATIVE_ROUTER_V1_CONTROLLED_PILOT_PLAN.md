# Native Router V1 — Controlled Single-Tool Serving Pilot Plan

**Pilot artifact:** `WR-NATIVE-ROUTER-V1-CONTROLLED-PILOT-001`  
**Candidate:** `WR-NATIVE-ROUTER-V1-CANDIDATE` (lifecycle remains **CANDIDATE**)  
**Flag:** `WR_NATIVE_ROUTER_V1_PILOT` default **OFF** (independent of `WR_NATIVE_ROUTER_V1_SHADOW`)

This is a bounded, reversible, single-tool serving pilot. It is not unrestricted production routing, not multi-tool, not a planner, and not WRIM/LoRA/EXP006/RED-X-2 training.

## Serving path

REQUEST → Native Router V1 candidate (`full` mode, `wrim_proba=None`) → eligible + confident?  
YES → compact intent through existing `routeToolIntent` → existing `executeNormalizedRequest`  
NO → existing `routeToolIntent` → existing `executeNormalizedRequest`

## Eligibility

1. Six-route single-tool scope: NO_TOOL, WEB, MEMORY, FILES, RESEARCH, SHA256  
2. Not `MULTI_TOOL_REQUIRED`  
3. Schema validation passes and compact intent is expressible  
4. Tool available  
5. Abstention is `ROUTE_CONFIDENT` or `NO_TOOL_CONFIDENT`  
6. No planner object

Otherwise fall back and record the reason.

## Kill switch

Set `WR_NATIVE_ROUTER_V1_PILOT=0` or unset it. No code edit. Existing router is sole authority.

## Evidence

Reuse `captureRuntimeTrajectory`. `REAL_RUNTIME_FRESH` only for genuine `REAL_RUNTIME` requests while the pilot flag is on. Fixtures and `REAL_TEST` are never relabeled.

## Checkpoints

25 / 50 / 100 eligible genuine pilot decisions are evidence targets, not auto-rollout triggers.
