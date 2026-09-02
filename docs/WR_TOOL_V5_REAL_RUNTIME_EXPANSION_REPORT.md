# WR-TOOL V5 — REAL RUNTIME EXPERIENCE EXPANSION

Identity: `WR-TOOL-REAL-TRAJECTORY-POOL-V5`  
Path: `model-lab/manifests/wr_tool_trajectories/WR-TOOL-REAL-TRAJECTORY-POOL-V5/`  
Does **not** overwrite pool V1, class-diversity V1, memory V1, V4, EVAL-4, or EXP004.

## Phase 0 preserve

Git branch `node01-source-sync` @ `973f0a7`. Dirty worktree preserved (no stash/reset/clean).  
WRIM-0 SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015` (weights file match).  
Active modules `[]`. V4 train hash frozen. EVAL-4 bundle frozen. EXP004 selected checkpoint hash preserved. Production path exists and was not touched.

## Sources inspected (reused, not paralleled)

`lib/agi-experience/*`, `trajectoryObserver` / `toObservationalCandidate`, `toolRouter` / `toolCatalog`, `/api/chat` execution, `/api/tools/*`, engineering file read surface, `runLiveResearchRouter`, `tavilyWarRoomSearch`, Model Lab V4/EVAL-4/EXP004, pool V1, class-diversity and memory ledgers.

## Collection

250 new development interactions through the existing observer (`captureRuntimeTrajectory` + quality gate).

| Class | Captured | Quality-passing (VERIFIED/SUPPORTED) |
| --- | --- | --- |
| NO_TOOL | 50 | 50 REAL_RUNTIME |
| WEB | 41 | 35 REAL_RUNTIME (6 fetch/HTTP fail → PARTIAL) |
| MEMORY | 53 | 51 TEST_FIXTURE (2 no-match PARTIAL) |
| FILES | 40 | 40 REAL_RUNTIME |
| RESEARCH | 36 | 36 REAL_RUNTIME (RSS/direct; Tavily 401 on 36 attempts) |
| SHA256 | 30 | 29 REAL_TEST VERIFIED (1 missing-arg PARTIAL) |

Tavily remains 401. WEB evidence used bounded public HTTPS fetch. RESEARCH succeeded via existing public RSS + direct legs despite Tavily.

MEMORY: live store was historically 3/2 decree. This mission created **32 labeled DEVELOPMENT TEST MEMORY RECORDS** (`TEST_FIXTURE`, never called REAL_RUNTIME). Retrievals ran against that fixture store.

## Quality

Observer quality gate: VERIFIED 29 / SUPPORTED 212 / PARTIAL 9 / REJECT 0.  
PARTIAL did not become gold. TEST_FIXTURE MEMORY SUPPORTED was **explicitly approved** for curriculum only.

## Verdict

**WR-TOOL V5 REAL EXPERIENCE EXPANSION — PASS**

Production untouched. WRIM-0 untouched. No commit.
