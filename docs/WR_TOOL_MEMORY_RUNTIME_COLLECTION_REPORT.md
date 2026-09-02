# WR-TOOL MEMORY REAL-RUNTIME COLLECTION REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
WRIM-0: **not modified** (SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`)  
Training / Experiment 004: **not started**  
Ledger: `model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-MEMORY-V1/`  
Does not overwrite: observer-dev, class-diversity, pool V1, EVAL-2, EVAL-3

**Final mission verdict:** WR-TOOL MEMORY REAL-RUNTIME COLLECTION AUTH-UNBLOCKED — PASS

**V4 readiness:** WR-TOOL V4 — READY FOR MATERIALIZATION REVIEW

This retry is after PostgREST auth diagnosis PASS (`sb_secret_` accepted by `createSupabaseAdminClient()`). Live retrieve used the `memories` table only. No MEMORY content was copied into this report.

## Phase 1 — local process

No `pnpm dev` / `next dev` process was running. The collector loads `.env.local` and `lib/supabase/admin.ts` directly. No production restart.

## Phase 2 — auth on runtime path

- `createSupabaseAdminClient()`: succeeds
- `memories` PostgREST/auth: succeeds (`SERVICE_AVAILABLE_WITH_DATA`)
- `war_room_approved_memories`: queried optionally (empty)
- `war_room_memory_records`: optional miss `PGRST205` / `missing_relation` — **deferred**, not treated as service failure

## Phase 3 — bounded inventory (`memories` only)

| field | value |
|---|---|
| row count | 3 |
| unique contents | 2 |
| category | `decree` only |
| topic flags present | `decree` (3), `memory` (3), `council` (2) |
| WR-TOOL experiment/core flags (Exp 004, WRIM-0, Exp 003, LoRA, Tavily, V4 gold) | none |
| content | omitted |

Requests were limited to facts the store actually contains (council decree; stored decrees). Experiment/core questions would have been honest NO_MATCH, not gold.

## Collection

Five live interactions: FILES, MEMORY (council), NO_TOOL, MEMORY (decree), MEMORY no-match probe.

| id | kind | retrieve | quality |
|---|---|---|---|
| bound_files_council_constitution | FILES | constitution line 169 `council` | SUPPORTED |
| bound_memory_council_decree | MEMORY | matchCount 2, store reachable, content omitted | SUPPORTED |
| bound_notool_durable_memory_term | NO_TOOL | no memory call | SUPPORTED |
| bound_memory_stored_decree | MEMORY | matchCount 3, store reachable, content omitted | SUPPORTED |
| memory_failure_nonexistent | MEMORY | matchCount 0, store reachable | PARTIAL (NO_MATCH, not gold) |

No-match is distinguished from service failure: `storeReachable=true`, `matchCount=0`.

## Quality / provenance

- VERIFIED 0 / SUPPORTED 4 / PARTIAL 1 / UNKNOWN 0 / REJECT 0
- MEMORY gold: 2 SUPPORTED (neither auto-VERIFIED)
- All captured `review_state=RAW`. No auto-curriculum. No training.
- Request / argument / result-status recovery: 100% on captured rows
- Exact/normalized duplicates: 0
- Unique families: 3 (files-vs-memory council, notool-vs-memory durable-memory, no-match probe)
- Secret sanitation: no Bearer, no JWT, no env assignment of the service secret, no process.env dump, no raw memory body in ledger (`contentOmitted: true`)

## `war_room_memory_records`

**DEFER.** Existing MEMORY tool path (`app/api/tools/memory`) and this collection use `memories`. Schema definition exists at `supabase/war_room_phase50d_memory_records.sql` if later authorized. **SCHEMA_REPAIR_REQUIRED: no** for this mission.

## Class space (not applied)

Do not silently change the eight-class V4 list. Operator-facing: `NO_TOOL`, `WEB`, `MEMORY`, `FILES`, `RESEARCH`. Gym-bounded: `SHA256`. Test/curriculum: `LOOKUP_NOTE`, `ECHO_INT`.

## Stop

Do not start Experiment 004, argument extraction, r=4, Recovery-012, WRIM1-RUN-000003, or promotion. V4 materialization review is allowed as a Commander decision; this mission does not materialize the dataset.
