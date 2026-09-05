# WR-TOOL REAL-RUNTIME OBSERVER DEV REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
WRIM-0: **not modified**  
Training: **not started**  
Experiment 004: **not started**  
Artifacts: `model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1/`  
Pool V1: **not overwritten**

Verdict: **WR-TOOL REAL-RUNTIME OBSERVER DEV WIRING — PASS**

PASS means development runtime can passively capture honest tool/no-tool experiences into the existing reviewable pipeline without changing tool behavior or the model. PASS does **not** mean V4 is ready or that Experiment 004 may start.

## Runtime path discovered

Chat: `/api/chat` → `execute.ts` → research intent / `runLiveResearchRouter` / Council Research Team → provider response. Observer flush is attached to existing `withTrace` after those facts exist.

WRIM compact tools: `parseToolIntent` → `validateToolIntent` → `normalizeToolRequest` → `executeNormalizedRequest` (dry_run / mock / bounded_sha256). Observation is opt-in via the third argument so Phase 1 unit checks are not mislabeled `REAL_RUNTIME`.

War Room APIs: non-health `GET/POST` memory and non-health `GET` files call `observeWarRoomApiTool` after the handler result is known.

## Insertion point

1. `app/api/chat/execute.ts` `withTrace` + `markLiveResearch` / `markCouncilResearchTeam` / `markNoToolReason`
2. `executeNormalizedRequest(..., observation?)` after `ToolResult` is built
3. `observeToolRouterResult` for parse/validate/NO_TOOL without execution

## Enablement

Development/test: on. Production `NODE_ENV`: always off. Opt-out: `WR_TOOL_TRAJECTORY_OBSERVER=0`. No hidden production activation.

## Capture session (this mission)

See `session-summary.json`. Highlights:

- New records in the observer ledger (including REAL_TEST latency probes and dry-run/mock): 38
- `REAL_RUNTIME`: 11 (sha256 8, NO_TOOL 2, invalid `curl` 1)
- Dry-run web/memory/research/lookup_note: `GYM_FIXTURE` (not REAL_RUNTIME)
- echo_int mock: `SYNTHETIC`
- All `review_state=RAW`; none auto-VERIFIED or curriculum
- Newly quality-bar gold (VERIFIED/SUPPORTED REAL_RUNTIME): **9** (mostly sha256 restatements)
- Arithmetic V4 gap 20−(12+9)=0; **design-useful gap excluding sha256 restatements: 6**
- WEB/RESEARCH/FILES/MEMORY **REAL_RUNTIME gold still 0** (live search not forced this session)

## Always-learning link (inactive weights)

Normal use → RAW capture → normalize → quality gate → later Commander curriculum → shadow training → eval → promotion. No weight updates during ordinary use.

## UI

Sovereign Model Lab dashboard: **DESIGN ONLY**. Minimal status: `GET /api/debug/trajectory-observer`.
