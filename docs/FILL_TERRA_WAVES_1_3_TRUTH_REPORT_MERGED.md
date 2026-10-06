# FILL TERRA WAVES 1–3 — MERGED TRUTH REPORT (AUTHORITATIVE FOR CHATGPT)
# Commander: Mark | 2026-09-17 | Personal Assistant + Swarm + Cursor cloud agent + Nebula parity

## LADDER
RESEARCH PROVEN ≠ IMPLEMENTED IN CODE ≠ LIVE RUNTIME ≠ VISUALLY VERIFIED
FILE_EXISTING_IS_NOT_DONE = true
ANY_WAVE_1_3_ROW_FULLY_DONE = NO (strict DONE bar unmet)

## TWO CHECKOUTS — DO NOT COLLAPSE
| Surface | SHA / state | OHGO / Caltrans / 511NY adapters |
|---|---|---|
| GitHub `origin/main` (cloud agent) | `822c333` | **ABSENT** — cloud MISSING labels correct for main |
| Nebula local branch `live-council-intelligence-repair` | `10a3d34` | **PRESENT** — ohgo_cameras, caltrans_cctv, ny511_cameras on disk + registry + coverageFederation |
| DEV :3001 | DOWN this run | — |
| INSTALLED :3848 | UP (next-server) + :3847 UP | smoke: coverage-state 401; live-intel 200 AUTH_REQUIRED; layers/weather 401; health 200 degraded |

**Implication for ChatGPT:** CURRENT DELTA “OHGO=LIVE / Caltrans=LIVE” refers to Commander research/runtime locks on Nebula — not to GitHub main `822c333`. Before claiming LIVE, re-prove with Commander session on 3848 (real still bytes). Do not implement OHGO again on a branch that already has adapters; do not assume main has them until merged.

## RESEARCH (PA2 / Swarm) — unchanged
WAVE_1/2/3_RESEARCH = DONE stamps (research sets closed).
Wave1 P0 research debt: router design OPEN; KYTC RealTime READY; CAP READY; MRMS READY; 511NY PARTIAL.
Wave2 READY densify: WSDOT/SG/NZ/FI/NDDOT/Iceland/USGS/AWC; HOLDs/UNFILLABLE/BLOCKED_EGRESS as locked.
Wave3 READY: DGT∪SCT, GDACS, EONET; CTBTO UNFILLABLE.
Legal: CTBTO UNFILLABLE; NRC public APS/RSS OK; keyed HOLD; DriveBC HighwayCams **NOT** UNFILLABLE (OGL-BC CSV ~1034 — Wave4 prove ingest vs link-out).

## IMPLEMENTATION — MERGED (cloud main + Nebula HEAD)

### Wave 1 P0
| Row | GitHub main 822c333 | Nebula 10a3d34 SOURCE | LIVE 3848 | VISUAL |
|---|---|---|---|---|
| Coverage router (mute/auto-enable/Nearby covering/Cincy OH+KY) | PARTIAL (bbox fetch-gate + coverageTruth; NOT full router) | PARTIAL (coverageFederation + coverageTruth; foreign rows can stay default On) | UNVERIFIED (coverage-state 401) | NO |
| KYTC RealTime TRIMARC stills | MISSING (wzdx_kytc only) | MISSING (wzdx_kytc only) | NO | NO |
| NWS CAP toast→flyTo→drawer | PARTIAL (nws alerts layer; no toast/Severe+/drawer) | PARTIAL (same class) | UNVERIFIED | NO |
| Mesonet MRMS ImageryLayer | MISSING | MISSING | NO | NO |
| 511NY stills | MISSING on main | PRESENT adapter, PROVIDER_AUTH / not_configured without key | UNVERIFIED | NO |
| OHGO baseline | MISSING on main | PRESENT adapters+registry | UNVERIFIED session | NO |
| Caltrans baseline | MISSING on main | PRESENT adapters+registry | UNVERIFIED session | NO |
| GIBS / ON / QC / HK / Digitraffic | PARTIAL | PARTIAL–PRESENT | UNVERIFIED | NO |
| Cincy streets/Centracs/OKI | honest NO_COVERAGE / UNFILLABLE | same | — | — |

### Wave 2 (camera densify + haz)
| Row | main 822c333 | Nebula 10a3d34 |
|---|---|---|
| WSDOT Cameras.json | MISSING (wzdx_wsdot ≠ cams) | MISSING as cams |
| NDDOT / SG / NZ / Iceland / Trafikverket / AZ511 | MISSING | MISSING |
| Digitraffic FI weathercam | PARTIAL | PRESENT (Finland envelope) |
| USGS quakes | PARTIAL | PRESENT |
| FIRMS / AWC METAR / RadNet / NRC EN / IAEA | MISSING | MISSING |

### Wave 3
| Row | Status |
|---|---|
| Spain DGT / Catalonia SCT / GDACS | MISSING both checkouts |
| EONET | PARTIAL (wildfires/volcanoes/floods layers; not full live_intel envelope) |
| CTBTO | UNFILLABLE (correct absence) |

## COVERAGE ROUTER CITY TESTS (cloud) — still MISSING
FOREIGN_REGIONALS_MUTED_FOR_OHIO = NO
Akron/Cincy/CA/NY/Spain/Catalonia/Singapore dedicated tests = MISSING
Cincy OH+KY camera stills path = MISSING (no OHGO on main; on Nebula OHGO present but TRIMARC stills still missing)

## WHAT CHATGPT SHOULD RETURN
1. One delta build order assuming **Nebula branch** is the working tree (do not re-add OHGO/Caltrans if already present).
2. Separate note: **merge/rebase** live-council-intelligence-repair → main so GitHub matches Nebula, OR cloud audits must target the live branch SHA.
3. Wave1 P0 still required: full coverage router UX; KYTC TRIMARC stills; MRMS; CAP toast UX; 511NY key finish; prove 3848 with session.
4. Never treat RESEARCH DONE as LIVE. Never fake coverage.

## CLOUD AGENT RAW REPORT (main 822c333) FOLLOWS
---
FILL_TERRA_WAVES_1_3_TRUTH_REPORT
AUDIT_DATE = 2026-09-17
AUDIT_MODE = READ_ONLY
GIT_BRANCH = main
GIT_HEAD = 822c333
REPO = github.com/markbroughton9205/war-room-os
DONE_BAR = CODE_PRESENT + REGISTERED + COVERAGE_ROUTED + RUNTIME_REACHABLE + REAL_DATA_PROVEN + TRUTHFUL_EMPTY/ERROR_STATE + UI_CONNECTED
FILE_EXISTING_IS_NOT_DONE = true
THIS_AUDIT_VISUAL = NO
THIS_AUDIT_WARROOM_RUNTIME_PROBE = NO

DISTINCTION
RESEARCH_PROVEN = WAVE_1_RESEARCH + WAVE_2_RESEARCH + WAVE_3_RESEARCH locked by Commander FILL TERRA prompt 2026-09-16/17 (Waves 1–3 DONE lock). Research lock ≠ code.
IMPLEMENTED_IN_CODE = what exists on this checkout (God’s Eye / Terra Phase 3–5 + swarm 2026-08-28). No FILL TERRA Wave 1–3 commit exists on main.
LIVE_IN_RUNTIME = War Room Next.js /api/terra not running on this VM (no :3000). Commander session gate on layers route unprobed. INSTALLED Node01 not on this host.
VISUALLY_VERIFIED = not performed (no Terra UI session this audit).

WAVE_1_RESEARCH = DONE
WAVE_2_RESEARCH = DONE
WAVE_3_RESEARCH = DONE
WAVE_1_IMPLEMENTATION = MISSING
WAVE_2_IMPLEMENTATION = PARTIAL
WAVE_3_IMPLEMENTATION = PARTIAL
WAVE_1_P0_FIRST_PRIORITY = YES
ANY_WAVE_1_3_ROW_DONE = NO

WAVE_1_P0_COVERAGE_ROUTER = PARTIAL
WAVE_1_P0_KYTC_TRIMARC = MISSING
WAVE_1_P0_NWS_CAP = PARTIAL
WAVE_1_P0_MESONET_MRMS = MISSING
WAVE_1_P0_511NY = MISSING
WAVE_1_BASELINE_OHGO = MISSING
WAVE_1_BASELINE_CALTRANS = MISSING
WAVE_1_BASELINE_GIBS = PARTIAL
WAVE_1_BASELINE_ONTARIO = PARTIAL
WAVE_1_BASELINE_QUEBEC = PARTIAL
WAVE_1_BASELINE_HONG_KONG = PARTIAL
WAVE_1_BASELINE_DIGITRAFFIC = PARTIAL
WAVE_1_CINCY_STREETS_CENTRACS_OKI = MISSING

WAVE_2_WSDOT = MISSING
WAVE_2_NDDOT = MISSING
WAVE_2_SINGAPORE = MISSING
WAVE_2_NZTA = MISSING
WAVE_2_ICELAND = MISSING
WAVE_2_DIGITRAFFIC_FI_WEATHERCAM = PARTIAL
WAVE_2_TRAFIKVERKET_SE = MISSING
WAVE_2_AZ511 = MISSING
WAVE_2_USGS = PARTIAL
WAVE_2_FIRMS = MISSING
WAVE_2_AWC_METAR = MISSING
WAVE_2_RADNET = MISSING
WAVE_2_NRC_EN = MISSING
WAVE_2_IAEA_NEWS = MISSING

WAVE_3_SPAIN_DGT = MISSING
WAVE_3_CATALONIA_SCT = MISSING
WAVE_3_GDACS = MISSING
WAVE_3_EONET = PARTIAL
WAVE_3_CTBTO = UNFILLABLE

COVERAGE_ROUTER_AKRON = MISSING
COVERAGE_ROUTER_CINCINNATI_OH_KY = MISSING
COVERAGE_ROUTER_CALIFORNIA = MISSING
COVERAGE_ROUTER_NY = MISSING
COVERAGE_ROUTER_SPAIN = MISSING
COVERAGE_ROUTER_CATALONIA = MISSING
COVERAGE_ROUTER_SINGAPORE = MISSING
COVERAGE_ROUTER_CITY_TESTS = MISSING
FOREIGN_REGIONALS_MUTED_FOR_OHIO = NO

SOURCE_STATE = THIS_CHECKOUT_MAIN_822c333
DEV_RUNTIME = NOT_RUNNING
INSTALLED_RUNTIME = NOT_DETECTABLE_THIS_VM

EVIDENCE_WAVE_1_P0_COVERAGE_ROUTER
RESEARCH = mute non-covering; auto-enable covering; Nearby=covering only; yellow only if empty/zero Online; Cincy=OH+KY
CODE_PRESENT = PARTIAL — lib/terra/coverageTruth.ts 7-state model; per-source bbox envelopes; TerraTrafficLayer skips fetch outside envelope / at global scale. Not a location coverage router.
REGISTERED = N/A (architecture, not a provider)
COVERAGE_ROUTED = PARTIAL — fetch-gated by bbox intersect, not by place (Akron/Cincy/CA/NY/ES/CT/SG). No mute of UI rows. No auto-enable covering. Nearby = OSM landmarks, not covering cameras.
RUNTIME_REACHABLE = NO this audit
REAL_DATA_PROVEN = NO this audit
TRUTHFUL_EMPTY/ERROR_STATE = PARTIAL — traffic uses coverageTruth (empty→NO_DATA, outside→NO_COVERAGE). Hazard TerraLayerRow maps empty to "LIVE — NO EVENTS" (violates never-LIVE-on-zero). NO_COVERAGE badge is amber; Wave 1 wants yellow only for empty/zero Online.
UI_CONNECTED = PARTIAL — badges on traffic rows; command-center defaultEnabled=true for ALL 13 traffic layers (Finland/HK/QC stay On over Ohio; fetch null only). Workspace defaultEnabled=false (no auto-enable).
WHY_NOT_DONE = missing mute/auto-enable/Nearby-covering/Cincy OH+KY/yellow rule/city tests

EVIDENCE_WAVE_1_P0_KYTC_TRIMARC
RESEARCH = KYTC RealTime TRIMARC HTTPS stills (not WGS84WM 404s)
CODE_PRESENT = NO TRIMARC / RealTime stills. Present instead: wzdx_kytc work-zone GeoJSON only (lib/research-engine/providers/wzdx_kytc.ts, WZDx v4.1)
REGISTERED = NO for TRIMARC. YES for wzdx_kytc (wrong product)
COVERAGE_ROUTED = KY WZDx bbox west:-89.6 south:36.4 east:-81.9 north:39.2 (covers Cincy metro, not Akron)
CAMERA_PROXY = NO kytc/trimarc host in cameraImageProxy.ts (only digitraffic, 511on.ca, tdcctv.data.one.gov.hk)
RUNTIME_REACHABLE = NO
REAL_DATA_PROVEN = NO TRIMARC this audit
UI_CONNECTED = WZDx events only, not stills
WHY_NOT_DONE = WZDx ≠ TRIMARC HTTPS stills

EVIDENCE_WAVE_1_P0_NWS_CAP
RESEARCH = toast → flyTo → drawer; User-Agent; Severe+
CODE_PRESENT = PARTIAL — nwsWeather.ts GET /alerts/active, User-Agent WarRoomOS-ResearchEngine/1.0, polygons preserved, zone-only skipped, normalizeNwsAlerts, layer nws_severe_weather_alerts
REGISTERED = YES (providerEnv + registry + layerCatalog)
COVERAGE_ROUTED = NO — defaultQueryText="alerts" nationwide; no place router; no Severe+ filter (all severities kept; identifiers.severity verbatim)
RUNTIME_REACHABLE = route exists app/api/terra/layers/[layerId]/route.ts; not live-probed; requires Commander session
REAL_DATA_PROVEN = prior-phase comments only, not this audit
TRUTHFUL_EMPTY/ERROR_STATE = PARTIAL — zone-only skipped honestly; TerraLayerRow empty="LIVE — NO EVENTS"
UI_CONNECTED = PARTIAL — layer toggle + polygon markers; generic entity click flyTo (not CAP toast); Observed Data panel + Related Intelligence (not CAP drawer); DEFAULT_ENABLED_LAYER_IDS = usgs_earthquake_feed only so NWS is OFF in command center and workspace until toggled. No toast component.
WHY_NOT_DONE = no toast, no Severe+ gate, not auto-on, no CAP drawer, not runtime/visual proven

EVIDENCE_WAVE_1_P0_MESONET_MRMS
RESEARCH = Mesonet MRMS ImageryLayer on GIBS base
CODE_PRESENT = NO. Cesium ImageryLayer stack is GIBS True Color + optional ion World Imagery + OSM only (TerraEarthImagery.tsx). No MRMS/mesonet id in GIBS_LAYERS or Terra.
REGISTERED = NO
COVERAGE_ROUTED = NO
RUNTIME_REACHABLE = NO
REAL_DATA_PROVEN = NO
UI_CONNECTED = NO
WHY_NOT_DONE = absent

EVIDENCE_WAVE_1_P0_511NY
RESEARCH = 511NY stills finish
CODE_PRESENT = NO (zero 511ny/511ny.org/cameras.dot.ny.gov hits)
REGISTERED = NO
CAMERA_PROXY = NO
RUNTIME_REACHABLE = NO
REAL_DATA_PROVEN = NO
UI_CONNECTED = NO
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_WSDOT
RESEARCH = WSDOT Cameras.json ~1705 keyless
CODE_PRESENT = NO Cameras.json. Present: wzdx_wsdot WorkZoneFeed (events, WA bbox)
WHY_NOT_DONE = WZDx ≠ Cameras.json → MISSING for this row

EVIDENCE_WAVE_2_NDDOT
CODE_PRESENT = NO geojson_nc / FullPath adapter
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_SINGAPORE
CODE_PRESENT = NO data.gov.sg traffic-images adapter (singstat exists, unrelated)
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_NZTA
CODE_PRESENT = NO journeys/trafficnz adapter
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_ICELAND
CODE_PRESENT = NO Vegagerðin adapter
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_DIGITRAFFIC_FI_WEATHERCAM
RESEARCH = ~809 weathercam
CODE_PRESENT = YES — digitraffic_road_cameras (tie.digitraffic.fi weathercam v1 + JPEG proxy)
REGISTERED = YES (providerEnv, registry, layerCatalog, TERRA_TRAFFIC_LAYER_DEFS, hostAllowlist)
COVERAGE_ROUTED = YES for Finland only (19.0E–31.6E, 59.5N–70.2N). Does not cover Ohio. Command-center layer still default On worldwide (fetch null outside envelope).
RUNTIME_REACHABLE = NO this audit
REAL_DATA_PROVEN = swarm 2026-08-28 claimed HTTP 200; not re-proven this audit
TRUTHFUL_EMPTY/ERROR_STATE = YES via coverageTruth + roadCameraStaleness (LIVE/STILL/STALE/OFFLINE)
UI_CONNECTED = YES (traffic row, hover card, camera-image proxy)
WHY_NOT_DONE = RUNTIME_REACHABLE + REAL_DATA_PROVEN + visual this audit fail DONE bar; FILL TERRA router/Nearby not applied

EVIDENCE_WAVE_2_TRAFIKVERKET_SE
CODE_PRESENT = NO
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_AZ511
RESEARCH = keyed CAM P1
CODE_PRESENT = NO adapter (FL511/Alberta Iteris 400 Invalid Key documented; AZ511 not in registry)
WHY_NOT_DONE = absent (not BLOCKED: nothing waiting on a present adapter + missing key)

EVIDENCE_WAVE_2_USGS
RESEARCH = USGS GeoJSON (haz_quakes)
CODE_PRESENT = YES usgs_earthquake_feed + usgs_earthquake (GeoJSON)
REGISTERED = YES
COVERAGE_ROUTED = N/A global hazard; earthquake_feed default-on; not FILL TERRA place router
RUNTIME_REACHABLE = NO this audit
REAL_DATA_PROVEN = NO this audit
TRUTHFUL_EMPTY/ERROR_STATE = PARTIAL (empty labeled LIVE — NO EVENTS)
UI_CONNECTED = YES
WHY_NOT_DONE = not FILL TERRA-complete; runtime/visual unproven; empty-state LIVE wording

EVIDENCE_WAVE_2_FIRMS
RESEARCH = FIRMS MAP_KEY thermal anomalies; must not count as GIBS fires MVT
CODE_PRESENT = NO firms adapter, no FIRMS_MAP_KEY wiring in Terra. GIBS layer id=fires status=unavailable (Mapbox vector tiles, not rendered). Phase G doc rejected GEV FIRMS proxy reuse.
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_AWC_METAR
CODE_PRESENT = NO aviationweather/METAR adapter (opensky aircraft ≠ METAR)
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_RADNET
CODE_PRESENT = NO
WHY_NOT_DONE = absent

EVIDENCE_WAVE_2_NRC_EN
RESEARCH = nuclear when egress; Wave 4 still says egress prove
CODE_PRESENT = NO
WHY_NOT_DONE = absent (not BLOCKED: no adapter + no this-audit egress proof)

EVIDENCE_WAVE_2_IAEA_NEWS
RESEARCH = link-out
CODE_PRESENT = NO IAEA NEWS layer or link-out UI
WHY_NOT_DONE = absent

EVIDENCE_WAVE_3_SPAIN_DGT
RESEARCH = camaras.json ~1918 JPEG; do not double-count as Catalonia
CODE_PRESENT = NO
WHY_NOT_DONE = absent

EVIDENCE_WAVE_3_CATALONIA_SCT
RESEARCH = WFS+RenderService ~328; cameras_EU = DGT∪SCT non-overlapping
CODE_PRESENT = NO
WHY_NOT_DONE = absent

EVIDENCE_WAVE_3_GDACS
RESEARCH = events4app GeoJSON; live_intel/multihazard; NOT haz_nuclear
CODE_PRESENT = NO
WHY_NOT_DONE = absent

EVIDENCE_WAVE_3_EONET
RESEARCH = NASA EONET api/v3/events; NOT haz_nuclear
CODE_PRESENT = PARTIAL — nasaEonet.ts GET /api/v3/events?status=open&category=<cat>; allowlist wildfires|volcanoes|floods|severeStorms; three Terra layers (wildfires/volcanoes/floods). No uncategorized events feed, no severeStorms catalog row, not live_intel envelope.
REGISTERED = YES
COVERAGE_ROUTED = N/A global; not default-on
RUNTIME_REACHABLE = NO this audit
REAL_DATA_PROVEN = NO this audit
TRUTHFUL_EMPTY/ERROR_STATE = floods catalog notes real empty allowed
UI_CONNECTED = YES three hazard layers
WHY_NOT_DONE = not generic events/live_intel; runtime/visual unproven; must not be scored haz_nuclear (code does not)

EVIDENCE_WAVE_3_CTBTO
RESEARCH = CONFIRMED_UNFILLABLE (NDC/vDEC; no public Terra feed)
CODE_PRESENT = NO (correct)
STATUS = UNFILLABLE

COVERAGE_ROUTER_ARCHITECTURE
MECHANISM = rectangle-intersect vs hardcoded envelopes; null query ⇒ no fetch; coverageTruth(NO_COVERAGE|NO_DATA|LOADING|LIVE|STALE|OFFLINE|UNKNOWN)
TESTS = coverageTruth.validation.ts generic only (Quebec-shaped example bbox). Zero Akron/Cincinnati/California/NY/Spain/Catalonia/Singapore cases.
MUTE_NON_COVERING = NO (rows remain; command-center all traffic On)
AUTO_ENABLE_COVERING = NO
NEARBY_COVERING_ONLY = NO (Nearby Landmarks = Overpass POIs)
YELLOW_ONLY_EMPTY_ZERO_ONLINE = NO (amber used for NO_COVERAGE and STALE)
CINCY_EQUALS_OH_PLUS_KY = NO (no OHGO; KY = WZDx events not TRIMARC stills)
OHIO_CAMERA_PROVIDERS = none (no OHGO, no 511NY, no KYTC stills)

COVERAGE_LOGIC_AKRON
VIEW = ~41.08N, 81.52W
OHGO = MISSING
ONTARIO_511 = city view south of Ontario south=41.6 → no intersect; regional NE-Ohio/Lake Erie view with north≥41.6 AND span≤12° WOULD fetch Ontario cameras over Ohio — foreign regional leak
KYTC_WZDX = Akron north of 39.2 → no
DIGITRAFFIC_FI / HK / QC / WSDOT_WZDX / DRIVEBC / JARTIC = no city-scale intersect
TEST = MISSING

COVERAGE_LOGIC_CINCINNATI_OH_KY
VIEW = ~39.10N, 84.51W
OH_CAMERAS = MISSING
KY_TRIMARC = MISSING
KYTC_WZDX = YES intersect (north 39.2 includes Cincy) — work zones only, not stills
FOREIGN = Finland/HK/QC/ON/SG/ES do not cover city-scale Cincy
CINCY_OH_PLUS_KY_ROUTER = MISSING
TEST = MISSING

COVERAGE_LOGIC_CALIFORNIA
CALTRANS = MISSING
WSDOT_CAMERAS = MISSING
WSDOT_WZDX = WA only, not CA
TEST = MISSING

COVERAGE_LOGIC_NY
511NY = MISSING
ONTARIO = NYC city view no; border-regional NY view can intersect Ontario envelope
TEST = MISSING

COVERAGE_LOGIC_SPAIN
DGT = MISSING
WEBTRIS = England only
TEST = MISSING

COVERAGE_LOGIC_CATALONIA
SCT = MISSING
MUST_NOT_COUNT_DGT_AS_SCT = N/A (both absent)
TEST = MISSING

COVERAGE_LOGIC_SINGAPORE
TRAFFIC_IMAGES = MISSING
HK_CAMERAS = HK envelope 113.8–114.5E, 22.1–22.6N — does not cover SG
TEST = MISSING

FOREIGN_VS_OHIO
DIGITRAFFIC_FI_COVERS_OHIO = NO at city scale
HONG_KONG_COVERS_OHIO = NO
QUEBEC_COVERS_OHIO = NO
DRIVEBC_COVERS_OHIO = NO
JARTIC_COVERS_OHIO = NO
ONTARIO_CAN_COVER_OHIO_AT_REGIONAL_ZOOM = YES (bbox south 41.6 overlaps Lake Erie / northern OH views)
SPAIN_DGT_COVERS_OHIO = NO (absent)
SCT_COVERS_OHIO = NO (absent)
SINGAPORE_COVERS_OHIO = NO (absent)

SOURCE_STATE_DETAIL
WHAT = git main 822c333; last terra/camera work is pre-FILL-TERRA God’s Eye (ON/QC/HK/FI/WZDx/USGS/EONET/NWS/GIBS). No OHGO, Caltrans, 511NY, TRIMARC, MRMS, WSDOT Cameras.json, NDDOT, SG, NZTA, Iceland, Trafikverket, AZ511, FIRMS, AWC METAR, RadNet, NRC EN, IAEA NEWS, DGT, SCT, GDACS, CTBTO.
RESEARCH_VS_CODE_CONFLICT = prompt BASELINE LIVE lists OHGO + Caltrans; source has neither.

DEV_RUNTIME_DETAIL
NEXT_DEV = not listening (ports 26053/26054/26500/50052/2375/5901 only; no 3000)
TERRA_LAYERS_ROUTE = code present, not executed
CAMERA_IMAGE_ROUTE = code present, not executed
THIS_VM = Cursor Cloud Agent snapshot bld-20260917-65443146, gitSetup=reuse, egress unrestricted, no War Room app process

INSTALLED_RUNTIME_DETAIL
NODE01 = /Users/markbroughton/WarRoomNode01 and com.warroom.node01 are prior-session artifacts on Commander machine, not this VM
PRODUCTION_TERRA_FILL_WAVES = NOT_PROBED
CANNOT_CLAIM_LIVE_IN_RUNTIME = true

VISUALLY_VERIFIED_DETAIL
TOAST = not seen
FLYTO = code path exists for any marker click; CAP toast path absent
DRAWER = no CAP drawer; Related Intelligence is news panel
MRMS_OVERLAY = not in UI
511NY_STILLS = not in UI
COVERAGE_MUTE_AUTOENABLE = not in UI

HOLD_ROWS_NOT_IN_SCOPE = PA/MI/Turnpike/TfNSW/DriveBC/UK_NH/INDOT/MnDOT/FL511_SOAP remain HOLD per research; DriveBC events already exist from prior phase (do not reopen HOLD list)
UNFILLABLE_CONFIRMED = CTBTO; research also TxDOT plain stills + DelDOT legacy 404 (not Wave 1–3 implement rows)

STOP
NO_IMPLEMENTATION
NO_DIFF
NO_PR