# TERRA — NAVIGATION / STREET NAMES / LIVE SATELLITE / PEGMAN / NEARBY / TRAFFIC
# ChatGPT / Cursor RESEARCH + IMPLEMENTATION DELTA PACK
# Commander: Mark | 2026-09-17 | Research Swarm (4 waves) + JUMP/Nearby code audit
# RESEARCH COMPLETE — BUILD HELD until Commander authorizes a slice
# Canonical tree: Nebula live-council-intelligence-repair @ 10a3d34+
# Screenshots: 932 Springdale St, Akron OH 44310 · JUMP/GO/NEARBY/GPS OFF · Nearby NO_COVERAGE within 40 km · LAYER=STREET

MISSION
Help Commander Mark close Terra UX gaps that feel like Google Maps — WITHOUT Google scrape/rip — using lawful CesiumJS Terra paths only.
Do NOT treat research as shipped LIVE.
Do NOT create Terra2.
Do NOT commit/push/deploy/package without Commander authorization.
If planning only: DO NOT MODIFY FILES.

==================================================
COMMANDER ASK (from screenshots + chat)
==================================================
1) Typed address must land on DIRECT/exact location (Springdale JUMP went wrong)
2) Street names + yellow street lines globe-wide; names noticeable / pulsing / stabilized
3) Actual live up-to-date satellite photos
4) Street view: small Black man (pegman) icon; click → keyboard arrows walk yellow road line
5) NEARBY functional to exact location like Google Maps
6) Live traffic: congestion, construction, police, school zones, accidents + local traffic cams throughout Terra

==================================================
TEAM
==================================================
Personal Assistant (lead) · Personal Assistant 2 (wave runner) · Evidence Scout · Context Historian · Science Analyst · Blind Spot Checker · Legal Researcher

==================================================
UNIFIED REFUSE
==================================================
- Google Street View scrape / tiles / blue coverage lines
- Google Geocoding / Maps Platform as silent default
- Google satellite / basemap tile rip
- Fake cameras, fake traffic, fake police CAD, fake school flashers
- Fake Nearby green / composite 90%
- Globe-wide pulsing of every street label (perf + honesty HOLD)
- Claiming rooftop accuracy from Census/Nominatim interpolation
- Claiming “live satellite” = Google-Maps-fresh without license
- Terra2 · Phase 0 auth rewrite · Media Player merged into Terra
- Research DONE ≠ IMPLEMENTED ≠ LIVE ≠ VISUALLY VERIFIED

==================================================
WAVE 1 — GEOCODE / JUMP ACCURACY
==================================================
STATUS: RESEARCH DONE · PRODUCT PARTIAL

MATRIX:
| Option | Status | Notes |
|---|---|---|
| Census Geocoder | PARTIAL | street-range INTERPOLATION — not rooftop |
| Nominatim / OSM | PARTIAL | point-on-way; no housenumber for 932 Springdale |
| Photon (Komoot) | PARTIAL | ranks Springdale **Drive** above Springdale **Street** (~600 m wrong if rank-1) |
| Pelias (self-host) | PARTIAL | better control + OpenAddresses; ops-heavy |
| Overture addresses | PARTIAL | point theme |
| Summit County parcel / paid rooftop | UNVERIFIED | not proven this pass |
| Google Geocoding | REFUSE | |

LIVE PROBES (2026-09-17):
- Nominatim `932 Springdale St, Akron, OH 44310` → road only · lat 41.1041339 · lon -81.5215850 · Springdale Street (no house #)
- Photon same query → #1 Springdale Drive · #2 Springdale Street

CODE AUDIT (Nebula 10a3d34):
- Server Nominatim-first; Open-Meteo/GeoNames transient fallbacks
- JUMP and GO share geocode target; JUMP = instant flight
- For highway/residential result, camera targets returned point (not bbox center)
- Still street-level, not rooftop of #932

CURSOR DELTA W1:
1. Audit JUMP/GO resolve path end-to-end
2. Structured US parse (housenumber, street, city, state, ZIP, countrycodes=us)
3. Reject Drive≠Street name mismatch; multi-hit candidate picker
4. Match quality badge: ROOFTOP | INTERPOLATED | STREET | AMBIGUOUS
5. Never claim rooftop from Census/Nominatim alone
6. Optional Summit parcel / commercial rooftop when proven + licensed
7. REFUSE Google geocoder as default

==================================================
WAVE 2 — STREET NAMES + YELLOW ROAD LINES
==================================================
STATUS: RESEARCH DONE · DATA READY · PRODUCT PARTIAL

MATRIX:
| Item | Status |
|---|---|
| Road centerlines (yellow) | READY data (OSM / Overture transportation ODbL) · PARTIAL product |
| Street name labels | READY data · PARTIAL product (declutter + hysteresis + visible ODbL credit) |
| Pulse | PARTIAL — selected / NEARBY / hovered only · globe-wide HOLD (perf) |
| Stabilize / prefers-reduced-motion | READY path |
| Google SV blue coverage lines | REFUSE / UNFILLABLE |

SCIENCE (CesiumJS):
- Yellow lines: OSM MVT / Overture polylines; not Cesium OSM Buildings (those are buildings)
- Labels: LabelCollection / vector tiles; scale-by-distance; don’t pulse all roads
- Pulse: animate selected road id only (clock.onTick)

CURSOR DELTA W2:
1. Akron/Summit bbox first: yellow polylines + name labels at street zoom
2. Declutter + hysteresis; visible ODbL attribution
3. Local pulse only; honor prefers-reduced-motion
4. REFUSE Google tiles / SV blue lines
5. Later: scale envelope, not planet-wide spam

==================================================
WAVE 3 — LIVE / CURRENT SATELLITE
==================================================
STATUS: RESEARCH DONE · HONEST TIERS REQUIRED

MATRIX:
| Item | Status |
|---|---|
| NASA GIBS WMTS | READY / ACTIVE · STREAM_ONLY · show product date/age |
| Cesium ion World Imagery | STREAM_ONLY look · archive, not continuous live |
| Sentinel Hub | PARTIAL PROVIDER_AUTH |
| Sentinel COG self-host | PARTIAL OWNABLE (unproven) |
| Maxar / Planet | HOLD COMMERCIAL_RESTRICTED |
| Google sat/tiles | REFUSE / UNFILLABLE |

CURSOR DELTA W3:
1. Audit ACTIVE imagery provider on /terra
2. Prefer GIBS WMTS with visible product date/age in UI
3. ion = STREAM honesty label (not “live Google freshness”)
4. Sentinel only with Hub key or self-host COG
5. Maxar only if paid license
6. No Google
7. RETURN provider + sample tile age

==================================================
WAVE 4 — PEGMAN + NEARBY + LIVE TRAFFIC
==================================================
STATUS: RESEARCH DONE · PRODUCT PARTIAL

### Pegman (Commander lock)
- Icon: small **Black man** pegman billboard
- Click → keyboard arrows / WASD step along yellow road centerline graph
- Dual-pane street imagery: Panoramax and/or Mapillary hosted and/or Commander own capture
- Pegman follows imagery sequences + snapped road graph — not free-fly; gaps → honest NO_COVERAGE
- Google Street View / tiles = REFUSE

| Item | Status |
|---|---|
| Pegman + walk yellow road | PARTIAL — Cesium billboard + OSM/Overture graph snap + dual-pane imagery |
| Mapillary hosted | PARTIAL COMMERCIAL_RESTRICTED / CC — ToS before production |
| Panoramax / own imagery | PARTIAL OWNABLE |
| Google SV | REFUSE |

### Nearby @ Akron (CRITICAL)
CODE + RESEARCH AGREE:
- Akron ∈ OHGO coverage envelope
- True geographic NO_COVERAGE should NOT fire at Springdale
- Zero results should be NONE_WITHIN_RADIUS / COVERED-empty honesty — not yellow NO_COVERAGE
- Likely causes: covering-set/router bug · health seed ACTIVE ≠ CURRENTLY_HEALTHY · missing OHGO_API_KEY (retrieval fail, not geography) · wrong active coordinate after bad JUMP · stale UI/runtime
- Nearby queries loaded traffic_camera features via `/api/terra/layers/{layerId}` · 40 km radius · must use covering providers only after coverage router

### Live traffic stack (lawful)
| Item | Status |
|---|---|
| OHGO cams | RESEARCH READY · PROVIDER_AUTH key · 401 without key |
| OHGO incidents / construction / travel-delays | RESEARCH READY with key |
| WZDx 4.2 (incl. wzdx_kytc / wzdx_wsdot already in tree as zones) | READY research |
| Police live CAD | HOLD / often UNFILLABLE — no invent |
| School zones / flashers | PARTIAL OSM tags / DOT GIS — no invent live flashers |
| Congestion mosaic global | UNFILLABLE as Google-Traffic clone without licensed feed |

CURSOR DELTA W4:
1) Nearby Akron root-cause: OHGO in covering set? health CURRENTLY_HEALTHY vs seed ACTIVE? sample cameras GET with key? wrong JUMP lat/lon?
2) Pegman dark Black-man billboard; keyboard along yellow centerline; dual-pane Panoramax/Mapillary/own — REFUSE Google SV
3) Overlay OHGO WZDx + incidents/construction/travel-delays; no fake police/school
4) RETURN root cause + file paths + acceptance (Akron Springdale Nearby shows OHGO cams when key+health green)
STOP unless implement authorized.

==================================================
LEGAL (fold)
==================================================
- OSM street names/roads: ODbL — visible attribution / safe harbour link osm.org/copyright
- Mapillary: CC BY-SA + commercial ToS limits — verify before production
- Panoramax: per-instance licence
- Sentinel/GIBS: INGEST/stream OK under their terms; commercial VHR = REQUIRE-AUTH / HOLD
- Traffic cams: existing OHGO/511 locks stand — no scrape
- Google SV/tiles/geocode: REFUSE unchanged

==================================================
ONE-LINE TRUTH FOR COMMANDER
==================================================
Exact Google Maps parity is not available as a free open-source drop-in.
Lawful Terra path =
better geocode/parcel (not Nominatim-only)
+ OSM/Overture yellow roads + local pulse labels
+ GIBS-dated satellite honesty (ion = look, not live)
+ Black pegman on road graph + Mapillary/Panoramax/own
+ OHGO Nearby/traffic once router + key + health are green.
Akron yellow Nearby is a **state/honesty bug**, not empty Ohio.

==================================================
PROPOSED BUILD ORDER (when Commander authorizes)
==================================================
0. Confirm Nebula 10a3d34+ working tree
1. JUMP geocode honesty (W1) — Springdale acceptance: Street≠Drive; badge STREET vs ROOFTOP
2. Nearby Akron OHGO root-cause fix (W4) — no false NO_COVERAGE inside envelope
3. Yellow roads + labels Akron bbox (W2) — local pulse; ODbL credit
4. GIBS product-date honesty (W3)
5. Pegman Black man + keyboard + dual-pane Panoramax/Mapillary (W4)
6. OHGO traffic overlays: incidents/construction/WZDx (W4)
7. Optional: Summit parcel rooftop · Sentinel · Maxar if paid · school-zone GIS if lawful
DEFER: Live Intel HUD · Luxury weather particles · Media Player · FILL TERRA Wave1–3 cams (separate master prompt)

==================================================
RETURN FORMAT (when implementing)
==================================================
TERRA_NAV_STREET_TRAFFIC_REPORT

WAVE_1_JUMP =
WAVE_2_LABELS =
WAVE_3_SATELLITE =
WAVE_4_PEGMAN =
WAVE_4_NEARBY_AKRON_ROOT_CAUSE =
WAVE_4_TRAFFIC =

FILES_CHANGED =
RUNTIME_PROOF_3848 =
VISUAL_PROOF =
SCREENSHOT_PATHS =
NEXT_SLICE =

STOP.

==================================================
COMPANION DOCS (already on Nebula docs/)
==================================================
- TERRA_NAV_STREET_TRAFFIC_WAVE1_RESEARCH.md
- TERRA_JUMP_NEARBY_CODE_AUDIT.md
- TERRA_WAVES_1_3_IMPLEMENTATION_MASTER_PROMPT.md (FILL cams — separate)
- TERRA_CURRENT_IMPLEMENTATION_DELTA.md
- CHATGPT_EVERYTHING_WAR_ROOM_TERRA.md

END PACK — AWAIT COMMANDER IMPLEMENT AUTHORIZATION
