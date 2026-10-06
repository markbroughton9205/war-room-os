# TERRA GAPS → SOLUTIONS → EXECUTION PROMPT (DRAFT)
# Commander: Mark | Lead: Personal Assistant | Draft while War Room Research deepens
# Status: DRAFT — will update when swarm returns full audit
# Paste into ChatGPT/Cursor after FINAL stamp from research.

## Mission
Close Terra / God's Eye gaps and partials with lawful solutions. Do not create Terra2. Do not invent roadmap numbers. Do not start Wave 5 or WRIM training without Commander auth. Do not commit/push/deploy without Commander auth.

## Chain
COMMANDER → WAR ROOM → TERRA → COUNCIL → ASTRA

## Known gaps / partials inventory (pre-swarm refresh)

| ID | Item | State | Why | Best solution (research-backed) | Next action |
|----|------|-------|-----|----------------------------------|-------------|
| G01 | Commander-session auth | BLOCKER | `/api/terra/live-intel` + layers 401 on 3848 | Fix `wr_local_session` / requireCommanderSession continuity for packaged UI | Engineer: session continuity first |
| G02 | Live Intel UX | PARTIAL | Categories/i18n/world time not fully shipped | Compact glance→hover→inspect; original language first; CAP/world time | After G01 |
| G03 | Camera yellow NO_COVERAGE | EXPECTED+GAP | ON/HK/QC on in Cincinnati = honest regional miss | Coverage router: enable providers by bbox; OHGO for OH; KYTC if proven | Research in flight → then OHGO live |
| G04 | OHGO adapter | PARTIAL | PR #43 ready; stood down for ChatGPT | Reopen merge/validate when Commander wants OH cams | Commander go |
| G05 | Camera HOLDs | HOLD | PA license; MI/Turnpike HTML_VIEWER_ONLY; TfNSW key; DriveBC TLS | Keep HOLD until API/license clears | No fake adapters |
| G06 | Click→info | OPEN | Urban-detail PASS ≠ click panel | Cesium pick→skeleton→async enrich→coverage honesty | After auth stable |
| G07 | Ownable DEM | PARALLEL | ion World Terrain STREAM_ONLY | OpenTopography→terrain tiles; never silent ellipsoid | Parallel lane |
| G08 | Listings | PARTIAL | No IDX yet | Link-out only; auth_required until MLS | No scrape |
| G09 | Notes/questionnaire | OPEN | Not shipped UI | commander_notes; opt-in Council | After click→info |
| G10 | Street intel | RESEARCHED | Mapillary/Panoramax not in product | Dual-pane STREAM_ONLY / own-capture | Later phase |
| G11 | Begin-sim | OPEN | Needs owned geometry + collision | Cesium for Unreal later on owned tiles | After DEM/buildings |
| G12 | Global camera federation | PARTIAL | Many regions NO public API | Honest yellow; expand waves when Mark asks | Coverage router first |

## Reliability rules
POSSIBLE ≠ SHIPPED · STREAM ≠ POSSESS · WORLD-STATE ≠ SCENARIO
Yellow = true gap or wrong provider for location — never invent cameras

## Proposed execution phases
1. **Auth** — G01 so live-intel/layers/cameras APIs authorize on 3848
2. **Coverage router** — G03 registry bbox → auto provider select; mute irrelevant sources
3. **OHGO live** — G04 validate + merge when Commander authorizes (clears Cincinnati/OH yellow for cams)
4. **Live Intel** — G02
5. **Click→info** — G06
6. **Ownable DEM** — G07 parallel
7. **Notes** — G09
8. **Street dual-pane / sim** — G10/G11 later

## Refuse
Scrape · Google offline rip · fake coverage · private cams · auth bypass · Terra2

## Acceptance (phase 1–3)
- [ ] live-intel 200 on 3848 with session
- [ ] Cincinnati nearby cameras use OHGO (or show true NO_COVERAGE only if OHGO off/missing key)
- [ ] Ontario cams do not show yellow-as-error when map is in Ohio — they auto-mute or show “not for this region”
- [ ] No mock camera catalog

---
FINAL swarm sections will replace DRAFT tables when research returns.
