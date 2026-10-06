# TERRA_CURRENT_IMPLEMENTATION_DELTA
# Commander: Mark | 2026-09-17 | Personal Assistant + Swarm + Nebula parity + cloud audit
# RESEARCH / PLAN ONLY — STOP until Commander says implement
# Sources: FILL_TERRA_WAVES_1_3_TRUTH_REPORT_MERGED · PA2 corrected · CURRENT DELTA gaps · All Waves Combined

TERRA_CURRENT_IMPLEMENTATION_DELTA

CURRENT_BASELINE =
- Auth model PUBLIC / PROVIDER_AUTH / COMMANDER_PRIVATE = ACTIVE (do not re-run Phase 0 auth rewrite)
- God's Eye = ACTIVE_WITH_GAPS on installed Terra
- Camera federation = PARTIAL but active (bbox fetch-gate + coverageFederation; NOT full mute/auto-enable router)
- LOCAL NEWS / GPS / click→info / building visuals = PARTIAL (see TERRA_GAPS_CURRENT_DELTA — still open, not Wave1–3 FILL rows)
- Research Waves 1–3 = DONE stamps (research sets closed only)
- ANY Wave 1–3 row FULLY DONE (strict bar) = NO
- Checkout split: GitHub origin/main @ 822c333 LACKS OHGO/Caltrans/511NY adapters; Nebula branch live-council-intelligence-repair @ 10a3d34 HAS them. Working tree for builds = Nebula HEAD unless Commander orders otherwise. Merge note for ChatGPT/Cursor: do not re-add OHGO/Caltrans on Nebula; main is behind until merge/rebase.

SOURCE_DEV_3848_PARITY =
- SOURCE (Nebula 10a3d34): PRESENT — coverageFederation.ts · OHGO · Caltrans · Digitraffic/ON/QC/HK · 511NY (PROVIDER_AUTH gated) · wzdx_kytc + wzdx_wsdot (work zones ONLY) · NWS alerts layer (partial) · USGS · EONET partial · GIBS imagery stack
- SOURCE MISSING: KYTC RealTime TRIMARC stills · MRMS · NDDOT · WSDOT Cameras.json · SG/NZ/Iceland/Trafikverket/AZ511 · DGT/SCT · GDACS · RadNet/NRC EN/IAEA · FIRMS adapter · AWC METAR · full coverage-router UX
- DEV :3001 = DOWN this audit
- INSTALLED :3848 = UP (next-server) · :3847 UP · health 200 degraded
- Smoke @3848 (no Commander session): coverage-state 401 · live-intel 200 authState=AUTH_REQUIRED · layers/weather 401
- VISUALLY VERIFIED = NO this audit
- LIVE RUNTIME for OHGO/Caltrans/GIBS = UNVERIFIED re-prove with Commander session (research locks said LIVE; parity did not session-prove still bytes)

WAVE_1_P0 =
1. COVERAGE_ROUTER = PARTIAL — coverageFederation + coverageTruth + bbox fetch-gate EXIST; MISSING mute non-covering UI rows, auto-enable covering, Nearby=covering cams only, Cincy=OH+KY stills path, yellow-only-empty rule, city tests (Akron/Cincy/CA/NY/ES/CT/SG). FOREIGN_REGIONALS_MUTED_FOR_OHIO = NO
2. KYTC = RESEARCH READY (RealTime TRIMARC HTTPS JPEG) · IMPLEMENTATION MISSING (code has wzdx_kytc work zones only — NOT camera stills) · RUNTIME N/A
3. NWS_CAP = RESEARCH READY · IMPLEMENTATION PARTIAL (nws alerts layer + User-Agent; NO toast→flyTo→drawer, NO Severe+ gate as P0 UX) · RUNTIME layers/weather 401 without session
4. MRMS = RESEARCH READY (IEM/Mesonet) · IMPLEMENTATION MISSING (no ImageryLayer on GIBS base) · RUNTIME N/A
5. 511NY = RESEARCH PARTIAL · IMPLEMENTATION PRESENT on Nebula (ny511_cameras, PROVIDER_AUTH) · RUNTIME UNVERIFIED without key/session · ABSENT on GitHub main 822c333

WAVE_2_READY =
- RESEARCH READY (not wired as FILL cams unless noted): WSDOT Cameras.json ~1705 · NDDOT geojson_nc+FullPath · Singapore data.gov.sg traffic-images · NZ journeys/trafficnz ~313 · Iceland Vegagerðin ~500 · Digitraffic FI weathercam ~809 (FI adapter PRESENT on Nebula — Finland envelope only) · Trafikverket SE · USGS GeoJSON (quakes layer PRESENT) · AWC METAR · IAEA NEWS link-out (research)
- AZ511 = RESEARCH READY keyed CAM P1 (adapter MISSING — not BLOCKED, nothing waiting on present adapter)

WAVE_2_BLOCKED =
- NRC EN = BLOCKED_EGRESS (403) — Wave4 egress prove; adapter MISSING
- DriveBC HighwayCams stills fetch = PARTIAL/BLOCKED_EGRESS (TLS EOF on Scout) — CSV OGL-BC READY ~1034; NOT UNFILLABLE; link-out until JPEG prove (Wave4)
- FIRMS = PARTIAL MAP_KEY / quota — adapter MISSING (do not count GIBS fires MVT as FIRMS)

WAVE_2_HOLD =
- PA / MI / Turnpike / TfNSW / UK NH / INDOT / MnDOT-until-ToS / FL511 SOAP / other Iteris key walls = REQUIRE-AUTH HOLD
- Travel-IQ keyed US states · CARS AB/MB (and SK/NS/NL…) = PARTIAL → Wave4 keys
- Duke outage = LINK-OUT / Legal vs ingest — Wave4
- RainViewer = PERSONAL_OK gate only (not commercial default)

WAVE_3_READY =
- Spain DGT camaras.json ~1918 JPEG · Catalonia SCT WFS+RenderService ~328 (score cameras_EU as DGT∪SCT non-overlapping) — RESEARCH READY · IMPLEMENTATION MISSING
- GDACS events4app GeoJSON — RESEARCH READY · MISSING in code · NOT haz_nuclear
- NASA EONET api/v3/events — RESEARCH READY · IMPLEMENTATION PARTIAL (wildfires/volcanoes/floods layers; not full live_intel envelope) · NOT haz_nuclear

WAVE_3_BLOCKED =
- (none hard-blocked beyond Wave4 key/egress items rolled from W2) Korea ITS reachability → Wave4

WAVE_3_UNFILLABLE =
- CTBTO public Terra feed = CONFIRMED_UNFILLABLE (NDC/vDEC/SWP; link-out public pages only; REFUSE scrape)
- LatAm HTML portals (UOCT/CET/C5 etc.) = UNFILLABLE until PUBLIC JSON/stills
- TxDOT plain stills · DelDOT legacy 404 · MD video-only = UNFILLABLE (from Wave2 locks)
- Cincy streets / Centracs / OKI = honest NO_COVERAGE / CONFIRMED_UNFILLABLE

WAVE_4_BACKLOG =
- CARS AB/MB (+SK/NS/NL…) per-host key+GET
- NRC EN egress prove + RadNet stations bind (no plume invent)
- Korea ITS reachability
- Duke Legal vs link-out
- Travel-IQ keyed US + i-TRAFFIC ZA
- LatAm/Africa/ME if PUBLIC stills/JSON
- Broader EU / Basque stills
- Live Intel RSS densify + ReliefWeb appname
- US 511 leftover triage → candidate or CONFIRMED_UNFILLABLE
- DriveBC OGL-BC CSV: prove INGEST vs LINK-OUT + JPEG egress
- Gap closure pass until ~90% lawful per-envelope scorecard (never fake composite)

LIVE_INTEL_LANE =
- Separate execution prompt: LIVE_INTEL_PANEL_REVAMP_EXECUTION_PROMPT_FINAL.md
- Futuristic mute-hover war-room news HUD; feed Council; not a Terra2
- Status: RESEARCH/PROMPT READY · BUILD HELD · local news PARTIAL on Terra today

LUXURY_WEATHER_LANE =
- Separate execution prompt: TERRA_LUXURY_WEATHER_EXECUTION_PROMPT_FINAL.md
- Animated weatherman-style effects + notifications; particles ≠ measured weather
- Depends on honest weather layers (GIBS + future MRMS); BUILD HELD

MEDIA_LANE = SEPARATE
- War Room Media Player = War Room OS module, NOT merged into Terra
- Prompt: CHATGPT_WAR_ROOM_MEDIA_REVIEW_PROMPT.md · BUILD HELD

AUTH_SPLIT =
- PUBLIC | PROVIDER_AUTH | COMMANDER_PRIVATE = ACTIVE
- Public Earth sources must not be wr_local_session-gated
- OHGO = PROVIDER_AUTH (server-side OHGO_API_KEY)
- 511NY = PROVIDER_AUTH (key)
- Commander-private remains session-gated
- Do NOT re-execute stale Phase 0 “clear all 401s by forcing Commander session on public layers”

REFUSE_RULES =
- No scrape; no fake markers/radar/nuke maps; no Google rip / Street View scrape; no invent plumes
- No USIE; no DIY explosion classifier; no CTBTO SWP/vDEC bot
- No HOLD reopen without new API; no RainViewer as commercial default
- Particles ≠ measured weather; Media Player ≠ Terra module
- No invent cams for HTML portals; no double-count DGT as Catalonia
- Do not count GDACS/EONET/USGS as haz_nuclear
- No Terra2 / Council2 / ASTRA2; no Wave5 / begin-sim / IDX / WRIM training in this delta
- No commit/push/deploy/package without Commander authorization
- Never treat RESEARCH DONE as LIVE / VISUALLY VERIFIED
- Never fake green / composite 90%

PROPOSED_BUILD_ORDER =
0. Confirm working tree = Nebula 10a3d34 (or merge to main first) — no duplicate OHGO/Caltrans work
1. Wave1 P0 coverage router UX completion (mute / auto-enable / Nearby covering / Cincy OH+KY / city tests / yellow rule) on existing coverageFederation
2. Wave1 P0 KYTC RealTime TRIMARC HTTPS stills (new cam adapter — not WZDx)
3. Wave1 P0 NWS CAP toast→flyTo→drawer + Severe+ (extend existing nws layer)
4. Wave1 P0 Mesonet MRMS Cesium ImageryLayer + attribution
5. Wave1 P0 511NY stills finish (key in .env.local; prove not_configured→ready)
6. Session-prove OHGO + Caltrans + GIBS on 3848 (Commander eyeball) before calling LIVE
7. Wave2 keyless cams: WSDOT Cameras.json → NDDOT → SG → NZ → Iceland (Digitraffic FI already present — verify only)
8. Wave2 haz densify: FIRMS (MAP_KEY) · AWC METAR · USGS empty-state wording fix · IAEA link-out
9. Wave3: DGT∪SCT → GDACS → EONET live_intel envelope completion
10. Wave4 when keys/Legal/egress clear (CARS, NRC, DriveBC JPEG, Travel-IQ, Korea, Duke…)
11. Parallel lanes only after Commander reopen: Live Intel HUD · Luxury weather · Media (separate module)
12. Deferred: building visual quality · click→info remaining classes · GPS blocker · street intel license · ownable stack classify (from TERRA_GAPS_CURRENT_DELTA Priorities 4–8)

PROPOSED_FILE_TOUCH_LIST =
# Tentative — reconcile against Nebula tree before edit; no new registry system
- lib/terra/coverageFederation.ts (+ validation/tests: Akron, Cincy OH+KY, CA, NY, Spain, Catalonia, Singapore)
- lib/terra/coverageTruth.ts / godsEyeCoverageMatrix.ts (yellow/empty semantics; never LIVE-on-zero where forbidden)
- components/war-room/terra/* traffic layer defaults (mute non-covering; defaultEnabled policy)
- Nearby / camera inspect path (Nearby = covering cameras, not only OSM POIs)
- NEW: lib/research-engine/providers/kytc_trimarc_cameras.ts (or equivalent) + hostAllowlist + cameraImageProxy + layerCatalog + roadTrafficSourceRegistry + TERRA_TRAFFIC_LAYER_DEFS
- lib/research-engine/providers/nws* / nwsWeather.ts + UI toast/flyTo/drawer wiring
- TerraEarthImagery.tsx / GIBS layer config — add MRMS ImageryLayer (IEM WMS/TMS) + attribution
- lib/research-engine/providers/ny511_cameras.ts + .env.local 511NY_API_KEY (Commander supplies; never print)
- Wave2+: new providers wsdot_cameras, nddot_cameras, sg_traffic_images, nzta_cameras, iceland_vegagerdin (+ registry/catalog/proxy allowlist)
- Wave3+: dgt_cameras, sct_cameras, gdacs_events; extend nasaEonet / live-intel envelope
- docs only until authorize: keep FILL / CURRENT DELTA / this file in docs/
- DO NOT touch: Media Player into Terra; Terra2; auth split rewrite; CTBTO ingest; scrape paths

STOP — AWAIT COMMANDER IMPLEMENT AUTHORIZATION

No implementation.
No commit.
No push.
No deploy.
No package/reinstall.
