# WR-TOOL REAL-RUNTIME CAPTURE CONTRACT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Status: **DEVELOPMENT OBSERVATION ONLY**

This is the field contract for RAW observational trajectories. Missing facts stay `null` / `UNKNOWN`. Never fabricate.

## Record (conceptual)

| field | required | notes |
|---|---|---|
| trajectory_id | yes | Hash of request + decision + tool + arguments + timestamp |
| request_text | yes if recoverable | Sanitized |
| conversation_id / request_id | no | null if absent |
| decision | yes | `TOOL` \| `NO_TOOL` |
| tool_id | yes for TOOL | null for NO_TOOL |
| arguments | yes | Empty object if none; never invented |
| router_validation_status | no | Runtime codes (`VALID`, `MISSING_ARGUMENT`, …) |
| execution_status / tool_result_status | no | Runtime `ToolResult.status` or `not_executed` |
| result metadata | bounded | status, tool id, hash, preview if large |
| error metadata | no | Honest runtime error string |
| source_type | yes | `REAL_RUNTIME` only for genuine wired runtime; dry_run=`GYM_FIXTURE`; mock=`SYNTHETIC` |
| core_model_id / active_module_ids | yes | From `officialActiveCore()` |
| timestamp | yes | ISO |
| provenance | yes | insertion_point, capture=`observational` |
| context_dependence | no | `UNKNOWN` if not known |
| review_state | yes | Always `RAW` at capture |
| no_tool_reason | no | Only if runtime supplied one |

## Forbidden

Auto-VERIFIED, auto-curriculum, auto-train, auto-promote, production enablement via hidden flag, dumping `.env` / `process.env`.

## Gate

`isTrajectoryObservationEnabled()`: off whenever `NODE_ENV === 'production'`. Dev/test on unless `WR_TOOL_TRAJECTORY_OBSERVER=0`.
