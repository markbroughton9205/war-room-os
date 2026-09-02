# WR-TOOL FROZEN ROUTER SHADOW REPORT

Identity: `WR-TOOL-FROZEN-ROUTER-SHADOW-001`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-FROZEN-ROUTER-SHADOW-001/`

Development only. Flag `WR_TOOL_FROZEN_ROUTER_SHADOW` default **OFF**. Production `NODE_ENV` always off.

## Wiring

`observeToolRouterResult` in `lib/modular-intelligence/toolRouter.ts` may attach frozen-router provenance onto the **existing** trajectory observer (`captureRuntimeTrajectory`). No parallel ledger. No change to parse/validate/normalize/execute.

TypeScript validator: `lib/modular-intelligence/frozenRouterShadow.validation.ts` **8/8 PASS**.

## Offline observations

EVAL-6 test n=112 scored with the SHADOW classifier. Agreement with gold (treated as observed/verified route): **0.491**, equal to offline WRIM accuracy. Compact `TOOL=` fixtures also scored; they do not override routing.

`alters_routing`: false. Core `max_abs_diff`: 0.

Live chat collection was not required: the flag stays off unless an operator sets it in development.
