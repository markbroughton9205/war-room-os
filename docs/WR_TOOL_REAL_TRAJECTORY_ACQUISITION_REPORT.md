# WR-TOOL REAL TRAJECTORY ACQUISITION REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
WRIM-0: **not modified**  
Training: **not started**  
Verdict: **WR-TOOL REAL TRAJECTORY ACQUISITION — PASS**

PASS means an honest provenance-preserving pool + quality gate + V4/EVAL-3/EXP-004 **design**. PASS does **not** mean enough real data exists or that EXP-004 trained.

## Scientific answer

War Room **can** construct a provenance-preserving corpus from gym, Wave 8/8.1, parser, and router tests. It **cannot** yet claim REAL_RUNTIME tool experience: **0** dumps of `war_room_agi_experience_records` exist in this repo, and live DB was not queried. Do not fabricate REAL_RUNTIME.

## Pool

- Identity: `WR-TOOL-REAL-TRAJECTORY-POOL-V1`
- Hash: `861791ef4f27c945f87a64dc8901be110583992b9ae5d2d572415b2cb833b600`
- Path: `model-lab/manifests/wr_tool_trajectories/WR-TOOL-REAL-TRAJECTORY-POOL-V1/`
- n = 41 normalized

| provenance | n |
|---|---|
| REAL_RUNTIME | 0 |
| REAL_TEST | 23 |
| GYM_FIXTURE | 2 |
| REPLAY | 8 |
| SYNTHETIC | 8 |

| quality | n |
|---|---|
| VERIFIED | 10 |
| SUPPORTED | 21 |
| PARTIAL | 10 |
| UNKNOWN | 0 |
| REJECT | 0 |

Usable supervised gold (VERIFIED/SUPPORTED, non-replay, EVAL-3 families held out): **12**. Eval candidates: **41**.

## Weak / strong classes

- Weakest TOOL class in the pool: **echo_int** (0 TOOL trajectories)
- Then **web** and **memory** (synthetic boundary only)
- Strongest: **sha256** (gym + Wave 8/8.1)
- RESEARCH: 3 gym analogs (SUPPORTED), 0 live API; EXP-003 recall 0 remains the capability gap

## Hook

Existing `captureExperience` stores **ids/refs**, not full tool payloads. Dev observer: `lib/modular-intelligence/trajectoryObserver.ts` + `toObservationalCandidate`, now **wired in development** via `runtimeTrajectoryCapture.ts` (chat `withTrace`, optional WRIM executor observation, memory/files API). Production `NODE_ENV` remains **off**. Capture artifacts: `model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1/` (does not overwrite this pool).

## Validator

31/31 in `validator.json`. No live tool APIs during curation. Local sha256 only to verify gym digests.

## Next recommendation

**STOP.** Do not train EXP-004, raise rank, start argument heads, Recovery-012, WRIM1-RUN-000003, or promotion. A V4 **candidate** dataset now exists (`WR-TOOL-CURRICULUM-V4-CANDIDATE`, 27 routing gold, 100% real/test, MEMORY gold 2 VALID BUT NARROW). Experiment 004 remains **NOT READY**. See `docs/WR_TOOL_CURRICULUM_V4_MATERIALIZATION_REVIEW.md`. Do not start Experiment 004.
