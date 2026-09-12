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
| 17 | Council Session Intelligence | PASS / LIVE-VALIDATED / RESTART-VALIDATED / COMMITTED / CLOSED (`b7f93eb`; restart-proof docs `11c6b59`) — durable Round 1 → process restart → DB-only structured restore; conversation metadata rounds[] bounded (40) and rebuildable; message `councilDeliberationRound` is authority |
| 18 | Production Supervisor Activation | PASS / LIVE-VALIDATED / RECOVERY-VALIDATED / ACTIVATED / CLOSED — application build `1f46753`; watchdog installer fix `d5b8965`; final supervisor tip `1787aba`; live proof: watchdog SYSTEM/Ready; controlled crash auto-recovered (~57s); wrong DEV on :3000 safely replaced; cloudflared untouched; Ollama untouched; no restart storm; public `/api/health` 200 |
| 19 | Conversation Ownership Migration | PASS / IMPLEMENTED / VALIDATED / COMMITTED / LIVE-MIGRATED / CROSS-USER-VALIDATED / #17-REGRESSION-VALIDATED / CLOSED — implementation `1e1c218`; historical 109 rows assigned to AUTH_USER_A; NOT NULL + RLS live; A/B isolation proven; see `docs/WR_CONVERSATION_OWNERSHIP_MIGRATION.md` |
| 20 | Repair Branch Production Deployment | PASS / RECONCILED / VALIDATED / DEPLOYED / LIVE-VALIDATED / CLOSED — production + public health at exact release `2f1461a5c60cca52d3dc235c66f06b4c0750a6a2` (`gitDirty=false`); #18→#19 history fast-forwarded onto `live-council-intelligence-repair`; ownership non-enumeration PASS; rollback retained at `1e1c218`; no push |
| 21 | Agent Reach Evaluation / Capability Matrix | PASS / EVALUATED / VALIDATED / COMMITTED / CLOSED (`15a01897c43803f11acabb8ddf6aa64fcb6826c0`) — primary deliverable WAR ROOM AGENT CAPABILITY MATRIX (`lib/agent-capability-matrix`, `docs/AGENT_CAPABILITY_MATRIX.md`); validation **63/63 PASS**; Terra = Council Oracle / world-state layer; CAPABILITY≠AUTHORITY; no-self-escalation + child≤parent formalized; CURRENT≠TARGET; structural denies preserved (push/deploy/finance/self-mod/constellation spawn); **no powers granted**; #22 input contract + opening gates A–C only; **no #22 implementation**; **no push/deploy** |
| 22 | Ascension / Agent Development | **ACTIVE** — Phase 1–11C: offline Commander identity + local ownership (`docs/architecture/ASCENSION_PHASE11C_OFFLINE_COMMANDER_OWNERSHIP.md`); scrypt local auth; AppData SQLite conversations; Phase 11B Ollama chat owned locally; Supabase not required for local Commander; remote #19 preserved; link foundation only (no auto-sync); recovery NOT_IMPLEMENTED. Phase 11D: installable Windows application (`docs/architecture/ASCENSION_PHASE11D_INSTALLABLE_WINDOWS_APPLICATION.md`) — NSIS installer `desktop/dist-release/War Room OS Setup.exe`; installed `War Room OS.exe` live-proven: Core `:3847` + full local UI `:3848`, first-run local Commander bootstrap, live `huihui_ai/qwen3-abliterated:14b` reply via Ollama, restart persistence, single-instance focus, launch from both desktop and Start Menu shortcuts, uninstall preserves `%LOCALAPPDATA%\War Room OS`; `ICON_ACCEPTANCE: PASS` — Commander-supplied Earth + metallic W "WAR ROOM OS" artwork, not redesigned; live icon is the clean arrow-free export (`desktop/assets/war-room-os-icon.png`, sha256 `843af444…6f0b`, commit `701f60a`), verified independently on the source PNG, the ICO, the installed EXE, the desktop shortcut, the Start Menu entry, the window and the taskbar (`scripts/phase11d-icon-surface-proof.mjs`); `CODE_SIGNING: NOT_CONFIGURED` (Azure Trusted Signing remains opt-in via `WAR_ROOM_AZURE_SIGNING=1`; not a functional blocker, though Smart App Control can stall the first launch of a freshly built unsigned exe); **`PHASE_11D = COMPLETE`**; Phase 12: bounded NAVIGATION_AGENT (`docs/architecture/ASCENSION_PHASE12_NAVIGATION_AGENT.md`) over Phase 9 Terra Navigation Foundation; `NAVIGATION_AGENT = IMPLEMENTED`; MOBILE_GNSS NOT_SUPPORTED; LIVE_TRAFFIC NOT_IMPLEMENTED; PHONE_APP NOT_IMPLEMENTED; AUTO_START_WITH_WINDOWS OFF; agents=8; autonomy OFF; #23 NOT STARTED |
| 23 | Native Intelligence Advancement | NOT STARTED |

Terra side (not a new roadmap number): **Automatic urban streets/buildings** — PASS / LIVE-VALIDATED / COMMITTED (`9571af1`). See [`docs/terra/AUTOMATIC_URBAN_DETAIL.md`](terra/AUTOMATIC_URBAN_DETAIL.md).

**#18 DEV OOM boundary (separate defect — not supervisor):** DEV `:3001` twice OOMed (~33 min, ~15 GB JS heap, exit 134). Remains DOWN BY CHOICE. Do not restart DEV, raise heap, or add `NODE_OPTIONS` as part of #18/#19. Investigate separately (`work/build18/DEV_OOM_INVENTORY.md`).

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
