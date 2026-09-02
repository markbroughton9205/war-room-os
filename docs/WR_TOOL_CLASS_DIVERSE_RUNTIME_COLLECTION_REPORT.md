# WR-TOOL CLASS-DIVERSE REAL-RUNTIME COLLECTION REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified this mission**  
WRIM-0: **not modified**  
Training: **not started**  
Experiment 004: **not started**  
Ledger: `model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-CLASS-DIVERSITY-V1/`  
Original observer proof `REAL-RUNTIME-OBSERVER-DEV-V1/session-summary.json`: **intact** (`REAL_RUNTIME` still 11)

**Final mission verdict:** WR-TOOL CLASS-DIVERSE REAL-RUNTIME COLLECTION — PASS

**V4 readiness:** WR-TOOL V4 — MORE REAL EXPERIENCE REQUIRED

PASS means bounded genuine development runtime trajectories were captured, quality-gated as RAW, and not fabricated. PASS does **not** mean V4 may be trained.

Runtime estimate before start: ~30 minutes. Actual live calls completed in well under that (Tavily 401s were fast; RESEARCH used RSS; HTTPS fetches were short).

## What was exercised

| class | attempted | REAL_RUNTIME | usable gold | honest notes |
|---|---:|---:|---:|---|
| WEB | 7 | 7 | 2 | Tavily live path returned **HTTP 401** (key present, unauthorized). Gold is two successful **single-URL HTTPS fetches** (GitHub / Cloudflare status JSON). |
| RESEARCH | 4 | 4 | 4 | `runLiveResearchRouter` ran. Tavily leg failed 401; **public RSS** returned sources (`rssOk: true`, sourceCount 24). |
| FILES | 3 | 3 | 3 | `readEngineeringFile` on existing docs (boundary matrix, V4 design, observer report). No invented file content. |
| MEMORY | 3 | 0 | 0 | **Not exercised.** `SUPABASE_SERVICE_ROLE_KEY` is not in development `.env.local`. Not fabricated. |
| NO_TOOL | 3 | 3 | 3 | Compact `TOOL=none` + `detectResearchIntent`. One case (`SHA-256` explanation) had `research_intent=true` while still recorded NO_TOOL — review before gold use. |

## Hard boundaries

| pair | result |
|---|---|
| WEB vs RESEARCH (PSF chair) | Both executed. WEB Tavily **401 PARTIAL**. RESEARCH RSS **SUPPORTED**. Semantic pair exists; WEB side is not gold. |
| FILES vs MEMORY (observer RAW) | FILES **SUPPORTED**. MEMORY **skipped** (no service role). Pair incomplete. |
| NO_TOOL vs WEB (hash vs GitHub status) | NO_TOOL **SUPPORTED**. WEB Tavily lookup **401 PARTIAL**. Later GitHub status **JSON fetch** is WEB gold on a related topic. |

## Quality (this ledger only)

- VERIFIED 0 / SUPPORTED 12 / PARTIAL 5 / UNKNOWN 0 / REJECT 0  
- All `review_state=RAW`. No auto-VERIFIED. No auto-curriculum.  
- Newly usable gold: **12**  
- Argument recovery 100%. Result-status recovery 100%. Real wording 17. Exact/normalized duplicates 0.  
- Unique families 15. Largest family share ~11.8% (`fam.boundary.runtime.web-vs-research.psf-chair`).  
- EVAL-3 exact-input leak: **0**. EVAL-3 file not overwritten. EVAL-2 not touched.

## Observer / models

- Development observer remains on unless `WR_TOOL_TRAJECTORY_OBSERVER=0`. Production `NODE_ENV` off.  
- Passive observe also wired on `/api/internet/search` (tavily-only → WEB, else RESEARCH) and engineering repo read → FILES. Does not change tool results.  
- Capture persist dir for this mission is the class-diversity ledger (`skipExperience: true`).  
- Active WRIM-0 SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`. Active modules `[]`.

## Validator

`pnpm run validate:class-diverse-runtime` — Python **10/10**, TypeScript **10/10**.

## Follow-up (2026-08-31 MEMORY collection)

Ledger `REAL-RUNTIME-MEMORY-V1` did **not** overwrite this class-diversity ledger. MEMORY retry: development service-role **AVAILABLE**, live selects **SERVICE_FAILURE**, MEMORY gold still **0**. See `docs/WR_TOOL_MEMORY_RUNTIME_COLLECTION_REPORT.md`.

## Stop

Do not start Experiment 004, argument extraction, r=4, Recovery-012, or WRIM1-RUN-000003.
