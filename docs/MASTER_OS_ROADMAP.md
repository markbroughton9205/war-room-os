# War Room OS — Master Runtime Intelligence Roadmap

This is the numbered Commander execution track used for live intelligence,
Terra, Search, ASTRA, and Council closeouts. It is **not** the same numbering
as platform Phase A–D (`docs/runtime-roadmap.md`), architecture Phase 46–49
(`docs/architecture/CANONICAL_PHASE_ROADMAP.md`), or the 2026-08-28 swarm
completion list (`docs/SWARM_ROADMAP_COMPLETION_REPORT.md`).

## Current position

| # | Item | Status |
|---|---|---|
| 12 | Live Globe Intel Activation | PASS / LIVE-VALIDATED / COMMITTED / CLOSED (`fe74bfe`); maritime/provider defect repair CLOSED (`e9a8372`, hygiene `8d8b76b`) |
| 13 | Terra ↔ Council Intelligence Bridge | PASS / LIVE-VALIDATED / COMMITTED / CLOSED (`ad888b7`) |
| 14 | ASTRA Live Mission Orchestration | PASS / LIVE-VALIDATED / COMMITTED / CLOSED |
| 15 | Distinct B-Parameter Council Reasoning | PASS / LIVE-VALIDATED / COMMITTED / CLOSED (`44011e9`) |
| 16 | Real Council Deliberation Pipeline | PASS / LIVE-VALIDATED / COMMITTED / CLOSED (`9d78a96`) — PRIMARY→PHOENIX→REVISION/STAND_FIRM→AURORA→COMPLETE/DEGRADED/FAILED; do not begin #17 until inventory reviewed |
| 17 | Council Session Intelligence | NOT STARTED — inventory next |

Terra side (not a new roadmap number): **Automatic urban streets/buildings** — PASS / LIVE-VALIDATED / COMMITTED (`9571af1`). See [`docs/terra/AUTOMATIC_URBAN_DETAIL.md`](terra/AUTOMATIC_URBAN_DETAIL.md).

## ASTRA DATABASE PRE-DEPLOYMENT BLOCKER

`war_room_astra_missions` is **not** currently applied.

Migration exists: `supabase/war_room_phase58a_astra_live_missions.sql`

Current local/dev runtime uses `local_filesystem_fallback` at
`.war-room/astra-missions/`.

**REQUIRED BEFORE PRODUCTION DEPLOYMENT:** apply and validate
`supabase/war_room_phase58a_astra_live_missions.sql` against the intended
non-prod/production database according to normal deployment governance.

This is **not** a blocker to beginning #15. It **is** a blocker to production
deploy of ASTRA mission persistence. Re-surface this requirement during later
production migration/deployment roadmap items. Details:
[`docs/architecture/ASTRA_LIVE_MISSION_ORCHESTRATION.md`](architecture/ASTRA_LIVE_MISSION_ORCHESTRATION.md)
and [`docs/deploy-war-room-netlify-vercel.md`](deploy-war-room-netlify-vercel.md).
