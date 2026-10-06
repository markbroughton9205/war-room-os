# WAR ROOM TERRA — ALLTOGETHER PACK FOR CHATGPT
# Commander: Mark | 2026-09-17 | Personal Assistant + Research Swarm
# RESEARCH ONLY — builds held until Commander authorizes
# Canonical tree: Nebula live-council-intelligence-repair @ 10a3d34+

## HOW TO USE
Paste/upload this whole file into ChatGPT or Cursor as context.
Do not treat RESEARCH DONE as LIVE.
Do not commit/push/deploy without Commander authorization.
If planning only: DO NOT MODIFY FILES.

## EXECUTIVE SUMMARY (READ THIS FIRST)

### What you asked for today (screenshots @ 932 Springdale St, Akron)
1. JUMP/GO must land on the exact address
2. Street names + yellow road lines (noticeable / pulsing)
3. Live up-to-date satellite
4. Street-view pegman (small Black man) + keyboard along yellow line
5. Nearby like Google Maps at that point
6. Live traffic: cams, construction, accidents, police, school zones

### One-line truth
Exact Google Maps parity is not a free open-source drop-in. Lawful Terra path = better geocode/parcel + OSM yellow roads + GIBS-dated sat + Black pegman (Mapillary/Panoramax/own) + OHGO Nearby/traffic once router+key+health are green. Akron yellow Nearby is a **state bug**, not empty Ohio.

### What’s ALREADY in Terra workspace (baseline — do not rebuild)
- Auth split PUBLIC | PROVIDER_AUTH | COMMANDER_PRIVATE = ACTIVE
- God's Eye ACTIVE_WITH_GAPS · Cesium GIBS / ion imagery / OSM Buildings
- coverageFederation PARTIAL · OHGO / Caltrans / Digitraffic / ON / QC / HK · 511NY gated (on Nebula branch, not GitHub main 822c333)
- NWS alerts PARTIAL · USGS · EONET PARTIAL · Live Intel panel PARTIAL
- JUMP/GO uses Nominatim-first geocode (street-level, not rooftop)
- Nearby queries traffic cameras in 40 km — but can wrongly show NO_COVERAGE inside OHGO envelope

### What’s NEW from this research (proposed tweaks / add-ons — NOT built yet)
| # | New tweak / add-on | Why | Status |
|---|---|---|---|
| A | JUMP honesty: structured address, Drive≠Street check, multi-hit picker, ROOFTOP/STREET/AMBIGUOUS badge | Photon ranks Springdale Drive over Street; Nominatim has no #932 rooftop | RESEARCH DONE |
| B | Optional Summit County parcel / licensed rooftop geocoder | Only path to Google-like pin | UNVERIFIED / HOLD until proven |
| C | Yellow OSM/Overture road centerlines + street-name labels (Akron bbox first) | LAYER=STREET needs real named yellow lines | RESEARCH DONE · not shipped |
| D | Local pulse on selected/Nearby roads only (+ prefers-reduced-motion) | “Noticeable pulsing” without globe-wide spam | RESEARCH DONE |
| E | GIBS product date/age visible in UI | “Live sat” honesty vs Google-fresh myth | RESEARCH DONE |
| F | Black man pegman billboard + keyboard along road graph | Your street-view UX lock | RESEARCH DONE · not shipped |
| G | Dual-pane Panoramax / Mapillary / own imagery (REFUSE Google SV) | Lawful street-level | RESEARCH DONE · license gate |
| H | Nearby Akron root-cause fix (false NO_COVERAGE inside OHGO) | Screenshot bug | RESEARCH DONE · code audit agrees |
| I | OHGO traffic overlays: incidents / construction / travel-delays / WZDx | Live traffic feed ask | RESEARCH READY · needs key+wire |
| J | Police CAD / live school flashers | Often UNFILLABLE — no invent | HOLD / UNFILLABLE |
| K | FILL TERRA Waves 1–3 densify (KYTC stills, MRMS, WSDOT cams, DGT…) | Separate master prompt — coverage debt | RESEARCH DONE · not shipped |

### Highest-value first cuts when you authorize build
1. JUMP geocode honesty (Springdale Street≠Drive)
2. Nearby Akron OHGO false NO_COVERAGE fix
3. Yellow roads + labels (Akron bbox)
4. GIBS date/age honesty
5. Black pegman + dual-pane street imagery
6. OHGO incident/construction overlays

### Separate lanes still BUILD HELD
- FILL TERRA Waves 1–3 Implementation Master Prompt
- Live Intel panel revamp
- Luxury weather particles
- War Room Media Player (not inside Terra)

### Checkout warning
Build from Nebula `live-council-intelligence-repair` @ 10a3d34+ — NOT GitHub main @ 822c333 (main lacks OHGO/Caltrans/511NY).

---

# ========== PART A — NAV / STREET / SAT / PEGMAN / NEARBY / TRAFFIC ==========

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

# ========== PART B — JUMP / NEARBY CODE AUDIT ==========

# Terra JUMP / GO Nearby-Camera Code Audit

**Scope:** read-only audit of the Nebula branch source at `live-council-intelligence-repair` / `10a3d34c0d49d9b0106263de36cb02ab859e5a1e` (Terra high-res imagery fallback repair). No repository source files were edited.

## Top findings

### 1. Address resolution is Nominatim-first, server-side

- `app/api/terra/resolve-location/route.ts:13-105` is the search endpoint. It accepts typed `lat,lon` directly, otherwise parses coordinate text, then calls `resolveCommanderPlaceSearch()` for free text.
- `lib/terra/geocodeSearchPolicy.ts:262-313` calls Nominatim first. Only transient Nominatim failures fall back to Open-Meteo by default (`TERRA_FALLBACK_GEOCODER`), then configured GeoNames. Ambiguous results are returned to the UI rather than guessed.
- `lib/terra/resolveGeography.ts:105-195` uses the existing Research Engine Nominatim adapter, preserves the provider bbox, and requires exactly one coordinate-bearing result for a strong resolution.
- `lib/research-engine/providers/nominatim.ts:231-239,265-289` sends `format=json`, `namedetails=1`, `addressdetails=1`, a configured Terra User-Agent, and carries Nominatim's `[south,north,west,east]` bbox into the result.

### 2. JUMP uses the same resolved target as GO; only motion differs

- `components/war-room/terra/TerraLocationCommandInput.tsx:73-110,136-141` sends both buttons through the same resolver. GO sets `instantRequested=false`; JUMP sets `instantRequested=true`.
- `components/war-room/terra/TerraShell.tsx:2524-2605` makes the resolved target the active `SEARCH` location, stores its bbox, then calls `cinematicFlight.flyTo()` with the target point, bbox, place type, and instant flag.
- `components/war-room/terra/useTerraCinematicFlight.ts:100-131` converts the plan to Cesium `camera.flyTo()`.
- `lib/terra/cinematicFlyTo.ts:95-105,107-123,183-268` chooses framing conditionally: administrative/place results can use a provider bbox rectangle, but street/address/building/amenity results are deliberately treated as street inspection and use a point at a place-type altitude. Camera/traffic-camera inspect targets also use a point, not a coverage rectangle. `instantRequested` changes duration/mode, not destination coordinates. For this address, Nominatim returns `highway/residential`, so JUMP targets the returned point (`41.1041339,-81.5215850`) rather than the bbox center.
- Rectangle framing, when selected, is padded to a minimum `0.004` degrees and recenters degenerate world-spanning bboxes around the resolved point (`TerraShell.tsx:800-823`; equivalent planner logic in `lib/terra/cinematicFlyTo.ts:107-123`).

### 3. Nearby cameras are ranked from the already-loaded Terra layer index; the panel does not call providers directly

- `components/war-room/terra/TerraShell.tsx:1111-1173` flattens loaded `traffic_camera` features into the nearby index, then calls `nearbyPublicCameras()` using the active search/GPS point and a default radius of 40 km.
- `components/war-room/terra/TerraShell.tsx:1322-1416` plans discovery from the active point. `lib/terra/godsEye/cameraDiscovery.ts:17-70` builds a point-centered bbox for 40 km (expandable to 80 km), intersects the coverage registry, and enables only covering camera layer IDs.
- Enabled layers use `components/war-room/terra/TerraTrafficLayer.tsx:103-123` -> `useTerraLayer()` -> `/api/terra/layers/{layerId}?q=...` (`components/war-room/terra/useTerraLayer.ts:99-119`). The route (`app/api/terra/layers/[layerId]/route.ts:37-75`) invokes the provider through `executeResearch()` and projects normalized events.
- OHGO is wired as `ohgo_cameras` in `components/war-room/terra/terraTrafficLayerDefs.ts:83-92`, with Ohio coverage/query logic in `lib/terra/ohgoBoundingBox.ts:10-37`; its adapter requires server-side `OHGO_API_KEY` and queries the official bbox API (`lib/research-engine/providers/ohgo_cameras.ts:191-228`).

### 4. Why `NO_COVERAGE` can appear around Akron even though OHGO exists

- For the Nominatim result below (`41.1041339,-81.5215850`), OHGO's declared envelope is `{west:-84.9,south:38.4,east:-80.5,north:42.0}` (`lib/terra/ohgoBoundingBox.ts:10-11`), so the point is inside OHGO coverage. In this commit, the Nearby coverage classifier should therefore not report `NO_COVERAGE` for that point.
- `lib/terra/godsEye/nearbyCameraCoverage.ts:79-129` defines `NO_COVERAGE` strictly as **no wired provider envelope contains the point**. Zero cameras within 40 km is a different state: `NONE_WITHIN_RADIUS` (or `COVERED` while the index is still loading).
- Therefore an Akron `NO_COVERAGE` is most likely stale/mismatched runtime state (e.g. an older/main bundle, a different active coordinate, or a stale discovery prompt), or it is the per-layer status for a non-OHGO provider—not evidence that OHGO returned zero cameras. `main` is a different commit (`822c333`) and does not have the Nebula OHGO wiring per the branch audit context.
- Separate caveat: OHGO is `PROVIDER_AUTH`, not public/no-key (`lib/terra/coverageFederation.ts:61`, `lib/research-engine/providers/ohgo_cameras.ts:193-195,231-235`). Missing/invalid `OHGO_API_KEY` prevents catalog retrieval. The current Nearby classifier does not map a provider-authenticated **API** row to `PROVIDER_AUTH_REQUIRED`; after a failed/empty index it can surface `NONE_WITHIN_RADIUS`/`COVERED`, but that is still distinct from true `NO_COVERAGE`.

## Optional live Nominatim check

With a descriptive User-Agent, Nominatim returned one result for `932 Springdale St, Akron OH 44310`: **lat `41.1041339`, lon `-81.5215850`**. It resolved to `Springdale Street` (road) in West Hill, Akron, with bbox `41.1037670,41.1045150,-81.5215870,-81.5215390`; it did not return a house-number/building result.

# ========== PART C — WAVE 1 DEEP RESEARCH ==========

# TERRA NAV / STREET / TRAFFIC — WAVE 1 RESEARCH (DRAFT)

**Mode:** RESEARCH ONLY — no code edits, no scrapes, no builds.  
**Context:** War Room Terra @ 932 Springdale St, Akron OH 44310; JUMP/GO/NEARBY/GPS OFF; Nearby yellow `NO_COVERAGE` within 40 km `REGIONAL/PROVIDER_DEPENDENT`; LAYER CONTROLS STREET; God's Eye ACTIVE WITH GAPS; Live Intel open.  
**Stack lock:** CesiumJS Terra.  
**Date:** 2026-09-17 (America/New_York).

---

## 0. REFUSE LINES (CLEAR)

| Refuse | Why | Lawful substitute |
| --- | --- | --- |
| **Google Street View scrape / panorama rip** | Google Maps Platform ToS + Map Tiles API policies prohibit unauthorized caching, extraction, offline use, image analysis, geodata extraction; Street View print/offline restricted. Unlicensed scrape = contract + abuse risk. | Mapillary API + MapillaryJS; Panoramax/STAC; own lawful capture + OpenSfM |
| **Google tile rip / basemap scrape** | Same ToS; Map Tiles API only for authorized visualization under Agreement; no pre-fetch/index/store beyond Cache-Control. | Cesium ion Bing/World Imagery (licensed via ion); OSM raster/vector; MapLibre OSM styles; NASA GIBS (open) |
| **Google Maps Platform as “free” JUMP/Nearby** | Paid/licensed product; ToS bind display + caching. Not a silent drop-in. | Self-hosted Nominatim+Photon / Pelias; commercial geocoder under contract (HERE/Mapbox/Smarty) |
| **Private / residential cams; hacked / leaked feeds** | Standing War Room lock. | OHGO + other public DOT/511 stills |
| **NWS as “traffic”** | Weather alerts ≠ congestion/construction/cams. | OHGO incidents / travel-delays / construction / WZDx |
| **Mapillary Vistas as production dependency** | Prior War Room lock: RESEARCH/EVAL / NC-SA; not production. | Mapillary hosted stream (ToS) or Panoramax open imagery |
| **Claiming “live satellite photos” = Google/Maxar street-level freshness without license** | Dishonest UX; commercial licensing required for Maxar/Planet. | Honest latency labels: GIBS NRT hours; Sentinel-2 days; Bing/ion archive aerial |

Sources:  
- https://developers.google.com/maps/documentation/tile/policies  
- https://cloud.google.com/maps-platform/terms  
- War Room locks (GODS_EYE / TERRA_GAPS / TRAFFIC_CAMERA_FEDERATION)

---

## 1. WAVE 1 FINDINGS MATRIX

Status key: **READY** = lawful path + docs clear, implementable next wave · **PARTIAL** = works with gaps / auth / honesty UX · **HOLD** = research OK, blocked on license/auth/ops · **UNFILLABLE** = cannot honestly meet ask with current public/lawful stack

| # | User ask | Status | One-line finding |
| --- | --- | --- | --- |
| 1 | Typed address → **EXACT** location | **PARTIAL** | Open geocoders often return **street centroid**, not house 932; Photon can prefer **wrong street** (Drive vs Street). Rooftop needs OpenAddresses/parcel/commercial. |
| 2 | Street names + yellow street lines globe-wide, names pulsing | **PARTIAL** | Yellow lines via OSM vector/MVT in Cesium READY-ish; **noticeable globe-wide labels + pulse** = hard (LOD, density, perf); CSS/shader pulse at planet scale is a HOLD. |
| 3 | Live up-to-date satellite photos | **PARTIAL** / honesty **HOLD** | “Live” ≠ Google-Maps-fresh. GIBS NRT = hours; Sentinel-2 revisit ~5d; Bing/ion = high-res **archive**, not continuous live. Commercial Maxar/Planet = licensed HOLD. |
| 4 | Pegman + keyboard along yellow line | **PARTIAL** | Mapillary sequence nav + radius search READY pattern; Panoramax STAC READY; coverage gaps → honest NO_COVERAGE. Google SV = **REFUSE**. |
| 5 | Nearby works like Google Maps at exact location | **PARTIAL** | At Akron, OHGO envelope **should** cover; yellow `NO_COVERAGE` more likely **router/auth/GPS-OFF/wrong JUMP point** than “Ohio has no cams.” |
| 6 | Live traffic: congestion, construction, police, school zones, accidents + local cams | **PARTIAL** | OHGO: cams, incidents, travel-delays, construction, WZDx **READY** (key). Police CAD live = often **UNFILLABLE**. School zones = OSM tags / ODOT speed GIS **PARTIAL**. |

---

## 2. LIKELY ROOT CAUSES — WRONG JUMP FOR 932 SPRINGDALE ST, AKRON

### 2.1 Live probe (2026-09-17) — public Nominatim

Query: `932 Springdale St, Akron, OH 44310`  
→ **one hit**, `addresstype=road`, OSM way `21416498`  
→ `lat=41.1041339`, `lon=-81.5215850`  
→ **display:** “Springdale Street, West Hill, Akron…” — **no house number**  
URL: https://nominatim.openstreetmap.org/search?q=932+Springdale+St,+Akron,+OH+44310&format=json&addressdetails=1  

Structured Nominatim (`street=932 Springdale St&city=Akron&state=Ohio&postalcode=44310`) → **same road-only result**.

**Implication:** Even a “correct street” JUMP places camera on **street geometry centroid / representative point**, not parcel/rooftop of #932. User perceives “wrong place” if they expect Google-style rooftop.

### 2.2 Live probe — public Photon (Komoot)

Query: `932 Springdale St Akron OH 44310`  
→ **1st feature: Springdale Drive** (way `21416506`, ~41.1100, −81.5216) — **different street**  
→ **2nd feature: Springdale Street** (way `21416498`, ~41.1041, −81.5216)  
URL: https://photon.komoot.io/api/?q=932+Springdale+St+Akron+OH+44310&limit=5  

**Implication:** If JUMP takes **rank-1 without street-name / house-number / layer validation**, user lands **~600 m north on Springdale Drive** — classic “wrong place” bug.

### 2.3 Bug taxonomy (JUMP)

| Bug | Mechanism | Fit for Springdale |
| --- | --- | --- |
| **Bbox-center fly** | Client uses Nominatim `boundingbox` midpoint instead of `lat`/`lon` | Possible; Nominatim docs: use lat/lon for point; bbox for fitBounds only — https://nominatim.org/release-docs/latest/api/Output/ |
| **Street fallback as “address”** | No `addr:housenumber` / TIGER / OpenAddresses → `addresstype=road` accepted as exact | **Confirmed** on public Nominatim |
| **Wrong-street first hit** | Fuzzy / similar name (Drive vs Street); no `countrycodes=us` / viewbox bias / structured parse | **Confirmed** on Photon rank-1 |
| **Country / view bias** | Missing `countrycodes`, `viewbox`+`bounded`, or last-map bias → foreign Springdale | Less likely if “Akron OH” in string; still harden |
| **GPS OFF + GO** | GO may use map center / last camera, not geocode result | Check product path when JUMP vs GO |
| **Result layer not checked** | Accepting `venue`/`locality`/`postcode` when house fails | Mitigate: require `layer=address` (Pelias) or housenumber + confidence |

### 2.4 Geocoder comparison (rooftop / address accuracy)

| Engine | Data | Strengths | Weaknesses for exact JUMP | Sources |
| --- | --- | --- | --- | --- |
| **Nominatim** | OSM (+ optional TIGER US) | Correctness; structured search; reverse | Weak fuzzy; house numbers sparse → **street centroid**; public instance usage policy strict | https://nominatim.org/ · https://sumguy.com/nominatim-vs-photon-vs-pelias/ |
| **Photon** | OSM via Nominatim dump | Autocomplete, typos, speed | Reverse weak; **can rank wrong similar street**; no house → street point | same + Komoot Photon |
| **Pelias** | OSM + OpenAddresses + WhosOnFirst + GeoNames | Multi-source; `confidence` / `match_type` / `layer`; interpolation | Ops-heavy (ES fleet); still not magic rooftop everywhere | https://pelias.io/ |
| **Commercial** (HERE, Mapbox, Smarty, Google*) | Parcel / postal / proprietary | Highest US rooftop rates | Cost + ToS; *Google = licensed only, not scrape | https://csv2geo.com/blog/benchmarking-geocoding-apis-honest-numbers · arXiv MESSY STREETS https://arxiv.org/html/2609.01612 |

**MESSY STREETS (2026):** among open engines, Pelias recall ≫ Photon ≫ Nominatim on messy strings; once matched, positional error similar — retrieval/normalization is the differentiator.

**Recommendation for Wave 2 (research→design only):**  
1. Structured parse (housenumber, street, city, state, postcode, `countrycodes=us`).  
2. Prefer Pelias **or** Nominatim+OpenAddresses/TIGER with **reject** if `layer≠address` / no housenumber when user typed a number.  
3. Never silent-accept Photon rank-1 street without name equality check (`Springdale Street` ≠ `Springdale Drive`).  
4. Optional commercial rooftop under contract for US EXACT mode.  
5. UI: show match quality badge (`ROOFTOP` / `INTERPOLATED` / `STREET` / `AMBIGUOUS`).

---

## 3. STREET NAMES + YELLOW LINES + PULSING LABELS (CesiumJS)

### 3.1 What Cesium gives you

| Layer | Provides streets? | Provides street **names**? | Notes |
| --- | --- | --- | --- |
| **Cesium OSM Buildings** | No (buildings) | Building `name` metadata, not road labels | https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings |
| **MVTDataProvider** (experimental) | Yes — road geometry from MVT | Attributes preserved; **MapLibre symbol labels not auto-imported** | https://cesium.com/learn/cesiumjs-learn/load-mapbox-vector-tiles-in-cesiumjs/ · https://cesium.com/learn/cesiumjs/ref-doc/MVTDataProvider.html |
| **GeoJSON / CZML polylines** | Yes (clipped AOI) | Separate LabelCollection / point labels | Globe-wide GeoJSON = **not** viable |
| **3D Tiles vector (`vctr`) labels** | Point labels at scale | LOD via geometricError | https://www.endpointdev.com/blog/2025/02/cesium-place-label-vector-data-tiles/ |
| **cesium-vector-provider (MapLibre)** | Styled vectors | **Labels not yet feature-complete** historically | https://github.com/davenquinn/cesium-vector-provider |
| **Bing Aerial with Labels (ion)** | Roads in imagery + labels | Raster labels (not OSM yellow line control) | https://cesium.com/platform/cesium-ion/content/bing-maps-imagery |

### 3.2 Yellow street lines globe-wide

**READY (pattern):** Stream OSM-derived MVT (OpenMapTiles / Protomaps / self-hosted) → style `highway=*` polylines yellow; declutter by zoom; clamp to ground.  
**Caveats:** Cesium MVT→3D Tiles conversion is experimental; tile tree needs `minZoom`/`maxZoom`/`extent`; road features split across tiles need stable `osm_id` for picking.

### 3.3 Street names “noticeable / pulsing”

| Approach | Globe-scale viability | Caveats |
| --- | --- | --- |
| `LabelCollection` + `scale` pulse per frame | **HOLD** at dense urban/global | O(n) GPU/CPU; add/remove thrash; fuzzy glyphs; terrain clamp cost — Cesium community perf threads |
| `scaleByDistance` + show only near camera | **PARTIAL** | Feels Google-like locally; not “globe-wide names always on” |
| CSS/HTML overlay projected labels | **PARTIAL** | Sharp text; DOM explosion at scale; must sync with camera |
| Shader pulse on label atlas | **HOLD** | Custom; risk of illegibility / seizure-unfriendly; still density-limited |
| Raster basemap labels (Bing with Labels) | **READY** for readability | Not yellow OSM lines; not pulsing; ion ToS |

**Honest product language:** “Street names at street/city zoom with optional pulse” = PARTIAL/READY. “Every street name pulsing globe-wide” = **UNFILLABLE** without absurd cost / illegible clutter.

---

## 4. “LIVE” SATELLITE — WHAT IT CAN HONESTLY MEAN

| Source | Typical freshness | Ground resolution | Licensing | Terra role |
| --- | --- | --- | --- | --- |
| **NASA GIBS / Worldview** | Many products **hours** after observe (NRT ~3–5 h marketed); `/nrt` vs `/std` endpoints | MODIS ~250 m; not street | Open / Earthdata | Weather/hazard “recent Earth” — https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api · https://nasa-gibs.github.io/gibs-api-docs/access-basics/ |
| **Sentinel-2** | Revisit ~**5 days** equator (better mid-lat); HLS often **2–4 days** to viz | 10–60 m | Copernicus open | “Recent optical” not live street — https://dataspace.copernicus.eu/ |
| **Landsat 8/9** | Searchable ~**6 h** after acquire (USGS) | 30 m | USGS open | Same class as S2 for “recent” — https://www.usgs.gov/faqs/after-a-landsat-scene-collected-when-will-it-become-available-search-and-download |
| **Cesium ion Bing Aerial** | **Archive** mosaic; urban **~15 cm**, US/WE ~30 cm | Street-visible | Via Cesium ion ToS (Bing via Microsoft enterprise) | Best lawful **looks-like-maps** basemap — https://cesium.com/platform/cesium-ion/content/bing-maps-imagery |
| **Cesium ion Sentinel-2** | Cloud-optimized mosaic | 10 m class | ion | Not street-level |
| **Maxar / Planet** | Tasking/catalog: minutes–days depending product | Sub-meter / daily (Planet) | **Commercial license HOLD** | Only with contract — not rip |

**Refuse dishonest copy:** Do not label GIBS/S2 as “live satellite photos like Google.”  
**Honest tiers for UI:** `ARCHIVE_HIRES` (Bing/ion) · `NRT_COARSE` (GIBS) · `MULTIDAY_OPTICAL` (S2/HLS) · `COMMERCIAL_TASKED` (Maxar/Planet if licensed).

---

## 5. PEGMAN / STREET-LEVEL (LAWFUL)

### 5.1 Why Google SV is REFUSE

- Unlicensed scrape of Street View imagery/tiles = ToS violation (no bulk cache/extract; visualization only under Agreement).  
- Map Tiles / Street View policies: no unauthorized offline, extraction, ML on tiles without rights.  
- War Room lock explicit: **no Google Street View scrape; no Google tile rip.**

### 5.2 Mapillary (READY pattern, ToS-bound)

- **API:** graph endpoints; **radius search** by lat/lng (best image in radius); sequence tiles; `image_ids?sequence_id=` for ordered nav.  
  Docs: https://www.mapillary.com/developer/api-documentation  
- **Viewer:** MapillaryJS sequence + direction components (keyboard/arrow nav along capture sequence).  
  https://mapillary.github.io/mapillary-js/  
- **Demo pattern:** MapLibre + MapillaryJS dual-pane — https://github.com/mapillary/api-demo  
- **OpenSfM fields:** `camera_parameters`, `computed_rotation`, `atomic_scale` on image metadata.  
- **License posture:** API token required; commercial product use under Mapillary Terms + attribution; hosted imagery often **stream/display**, not free rehost; **Vistas = RESEARCH_ONLY** (prior lock).

**Pegman UX:** Small dark man icon = custom Billboard at sequence image position; place only where Mapillary/Panoramax coverage exists; hide or grey with `NO_COVERAGE` when radius search empty.

### 5.3 Panoramax (READY / open-leaning)

- STAC-style API; `getPicturesAroundCoordinates`, `getSequenceItems` for along-road sequence.  
  https://viewer.geovisio.fr/docs/reference/utils/API/  
- Open-data oriented (instance-dependent licenses: often CC BY-SA / Licence Ouverte).  
- Good complement where Mapillary thin / ToS preference for open.

### 5.4 Keyboard along yellow line

**PARTIAL:** Mapillary/Panoramax navigate **capture sequences**, not arbitrary OSM yellow centerline.  
Align by: project sequence LineString to nearest OSM way; arrow keys → prev/next image in sequence; if gap > N m → snap or show gap.  
**UNFILLABLE:** Continuous Google-style pegman everywhere yellow exists (imagery ≠ road graph coverage).

---

## 6. NEARBY `NO_COVERAGE` AT AKRON — WHAT IT MEANS

### 6.1 OHGO Ohio envelope (lawful cams)

- **OHGO Public API** cameras: https://publicapi.ohgo.com/docs/v1/cameras  
- Snapshots refresh ~**5 s**; lat/lon; `CameraViews` small/large URLs; **API key** (`PUBLIC_KEY_REQUIRED` / `PROVIDER_AUTH`).  
- Geographic scope: **State of Ohio** (ODOT) — Akron / Summit is **inside** the OHGO envelope, not outside like ON/HK/QC foreign regionals.

### 6.2 Interpreting yellow `NO_COVERAGE` within 40 km (REGIONAL/PROVIDER_DEPENDENT)

Given Akron ∈ Ohio, yellow is **unlikely** to mean “no public cams exist in Ohio.” More likely:

| Cause | Explanation | Wave |
| --- | --- | --- |
| **Coverage router incomplete** | Foreign regionals still “on”; Nearby not restricted to covering providers; yellow used for NO_COVERAGE broadly | Match existing FILL TERRA delta: `NEARBY_COVERING_ONLY=NO` on some trees |
| **OHGO AUTH_FAIL / key missing** | Adapter present on Nebula branch but session-unproven; mis-mapped to NO_COVERAGE | Re-prove keyed GET |
| **Wrong JUMP point** | Camera/query center on wrong street or null island → envelope miss | Fix geocode first |
| **GPS OFF + empty query center** | Nearby uses undefined/map-default center outside OH envelope | Bind Nearby to JUMP result |
| **Radius vs highway cam density** | OHGO denser on freeways; residential Springdale may have **zero cams within 40 km of that exact pin** even when Akron metro has cams — then yellow is **honest local empty**, not statewide NO_COVERAGE | Distinguish `NO_COVERAGE` (provider not applicable) vs `NO_DATA` (provider OK, zero in radius) |
| **Branch skew** | GitHub main historically missing OHGO adapters; Nebula has them — UI may run tree without OHGO | Align working tree |

**Product rule (from prior gaps research, reaffirmed):**  
Yellow `NO_COVERAGE` only when **covering set empty** OR **zero Online cams in radius** — never because Ontario/HK toggles are on while standing in Akron.

---

## 7. LIVE TRAFFIC STACK (OHIO / AKRON) — LAWFUL

| Need | Source | Status | Notes / URL |
| --- | --- | --- | --- |
| **Local traffic cams** | OHGO `/api/v1/cameras` | **READY** (key) | https://publicapi.ohgo.com/docs/v1/cameras |
| **Accidents / closures / incidents** | OHGO `/api/v1/incidents` | **READY** (key) | Accidents, weather road impacts, closures — https://publicapi.ohgo.com/docs/v1/incidents |
| **Congestion / delay** | OHGO travel-delays, dangerous-slowdowns | **READY** (key) | https://publicapi.ohgo.com/docs/v1/travel-delays · dangerous-slowdowns |
| **Construction** | OHGO construction + **WZDx 4.2** | **READY** (key) | https://publicapi.ohgo.com/docs/v1/construction · https://publicapi.ohgo.com/docs/work-zones · license CC0 on WZDx feed metadata |
| **Police activity** | Live CAD / LE feeds | **UNFILLABLE** (typical) | No general public statewide live police-position API; do not scrape restricted CAD. Optional: filtered OHGO incidents if category includes LE-related road events only — do not invent “police layer.” |
| **School zones** | OSM `hazard=school_zone` + `maxspeed:conditional`; ODOT TIMS speed/road inventory GIS | **PARTIAL** | OSM wiki tag; ODOT TIMS Road_Inventory / Speed_Zones MapServer — not a live “flashing lights now” feed. GTFS (Akron Metro) = **transit stops/routes**, not school-zone enforcement. https://wiki.openstreetmap.org/wiki/Tag:hazard%3Dschool_zone · https://tims.dot.state.oh.us/ |
| **NWS** | Alerts | **Not traffic** | Keep in weather/hazard lane only |

---

## 8. LAWFUL STACK RECOMMENDATION (NO GOOGLE RIP)

```
JUMP / geocode
  ├─ Primary: Pelias (OSM+OpenAddresses) OR Nominatim(+TIGER/OA) structured
  ├─ Autocomplete: Photon (with street-name guard) OR Pelias autocomplete
  ├─ Optional EXACT: commercial rooftop under contract
  └─ UX: match_type badge; refuse silent street-fallback when housenumber typed

Basemap / streets
  ├─ Imagery: Cesium ion Bing Aerial (ARCHIVE_HIRES) ± Labels
  ├─ Optional NRT overlay: NASA GIBS (coarse, time-aware)
  ├─ Yellow roads: OSM MVT → Cesium MVTDataProvider / vector tiles
  └─ Names: decluttered LabelCollection or vector-label tiles at city/street zoom

Street-level pegman
  ├─ Mapillary API + MapillaryJS (token, attribution, stream ToS)
  ├─ Panoramax instance(s) as open complement
  └─ REFUSE: Google SV / Maps tile scrape

Nearby + traffic (Akron/OH)
  ├─ Coverage router: OHGO (± adjacent KY only when view warrants)
  ├─ Cams / incidents / delays / construction / WZDx from OHGO
  ├─ School zones: OSM + ODOT GIS static/conditional
  └─ Health: LIVE | STALE | OFFLINE | AUTH_FAIL | NO_DATA | NO_COVERAGE
```

---

## 9. OPEN QUESTIONS — WAVES 2–4

### Wave 2 — JUMP correctness
1. Exact client code path: does JUMP use `lat/lon`, bbox center, or Photon rank-1?  
2. Is TIGER / OpenAddresses enabled on War Room Nominatim/Pelias instance?  
3. Product rule: if housenumber missing in data, show **STREET** badge + “approximate” vs hard-fail?  
4. Commercial rooftop budget / vendor shortlist (non-Google preferred for SV consistency)?

### Wave 3 — Streets / labels / pegman
5. Which MVT source (OpenMapTiles, Protomaps, self-hosted) is licensed for Cesium production?  
6. Pulse UX accessibility (epilepsy / motion) — commander decision.  
7. Mapillary org token + commercial ToS review for War Room display (COMMERCIAL_OK?).  
8. Akron Mapillary/Panoramax density along Springdale St specifically?

### Wave 4 — Nearby / traffic honesty
9. Session-prove OHGO cameras near Akron pin with real still bytes + count in 40 km.  
10. Split UI copy: `NO_COVERAGE` vs `NO_DATA` vs `AUTH_FAIL`.  
11. School-zone: ODOT TIMS GeoJSON rights for redisplay in Terra?  
12. Any **lawful** police/incident beyond OHGO categories, or permanently UNFILLABLE?

---

## 10. TOP 10 FINDINGS (EXECUTIVE)

1. **Public Nominatim does not rooftop “932 Springdale St”** — returns **Springdale Street road only** (centroid ~41.10413, −81.52159).  
2. **Public Photon ranks Springdale Drive above Springdale Street** — first-hit JUMP = **wrong street** (~600 m).  
3. Classic JUMP bugs: **bbox-center**, **street-as-address**, **no country/viewbox**, **no layer/confidence gate**.  
4. **Pelias / OpenAddresses / commercial** are the realistic path to EXACT; Nominatim alone = PARTIAL.  
5. **Cesium OSM Buildings ≠ street names**; use MVT + separate labels; globe-wide pulsing names = effectively UNFILLABLE.  
6. **“Live satellite” must be tiered** — GIBS hours/coarse; S2 days; Bing/ion high-res archive; Maxar/Planet licensed HOLD.  
7. **Google SV / tile rip = hard REFUSE**; Mapillary + Panoramax + own imagery only.  
8. **Pegman follows imagery sequences**, not every yellow OSM line — coverage gaps expected.  
9. **Akron is inside OHGO**; yellow Nearby is likely **router/auth/wrong-center/NO_DATA**, not “Ohio has no cams.”  
10. **OHGO already covers** cams, incidents, delays, construction, WZDx; **police live CAD** and **true live school flashers** remain thin/UNFILLABLE without new lawful feeds.

---

## 11. PRIMARY SOURCE INDEX

| Topic | URL |
| --- | --- |
| Nominatim output / bbox | https://nominatim.org/release-docs/latest/api/Output/ |
| Nominatim FAQ (reverse/border) | https://nominatim.org/release-docs/4.3/api/Faq/ |
| Nominatim vs Photon vs Pelias | https://sumguy.com/nominatim-vs-photon-vs-pelias/ |
| Pelias | https://pelias.io/ |
| MESSY STREETS geocoder bench | https://arxiv.org/html/2609.01612 |
| Cesium MVT | https://cesium.com/learn/cesiumjs-learn/load-mapbox-vector-tiles-in-cesiumjs/ |
| Cesium OSM Buildings | https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings |
| Cesium Bing Aerial | https://cesium.com/platform/cesium-ion/content/bing-maps-imagery |
| GIBS APIs | https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api |
| GIBS access basics | https://nasa-gibs.github.io/gibs-api-docs/access-basics/ |
| USGS Landsat latency | https://www.usgs.gov/faqs/after-a-landsat-scene-collected-when-will-it-become-available-search-and-download |
| Google Map Tiles policies | https://developers.google.com/maps/documentation/tile/policies |
| Mapillary API | https://www.mapillary.com/developer/api-documentation |
| MapillaryJS | https://mapillary.github.io/mapillary-js/ |
| Panoramax viewer API | https://viewer.geovisio.fr/docs/reference/utils/API/ |
| OHGO intro | https://publicapi.ohgo.com/ |
| OHGO cameras | https://publicapi.ohgo.com/docs/v1/cameras |
| OHGO incidents | https://publicapi.ohgo.com/docs/v1/incidents |
| OHGO WZDx | https://publicapi.ohgo.com/docs/work-zones |
| OSM school_zone | https://wiki.openstreetmap.org/wiki/Tag:hazard%3Dschool_zone |
| ODOT TIMS | https://tims.dot.state.oh.us/ |

---

**End Wave 1 draft.** Next: Wave 2 JUMP root-cause confirmation against Terra client geocode code (read-only); Wave 3 Mapillary coverage probe at Springdale pin; Wave 4 OHGO session proof + coverage-router copy split.

# ========== PART D — FILL TERRA CURRENT IMPLEMENTATION DELTA ==========

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

# ========== PART E — FILL TERRA WAVES 1–3 IMPLEMENTATION MASTER PROMPT ==========

# TERRA — WAVES 1–3 IMPLEMENTATION MASTER PROMPT
# Commander: Mark
# Canonical source: Nebula live-council-intelligence-repair @ 10a3d34 or newer descendant
# Research locks: 2026-09-16 / 2026-09-17
# CURRENT DELTA authoritative
# Auth split ACTIVE: PUBLIC | PROVIDER_AUTH | COMMANDER_PRIVATE
# Saved: 2026-09-17 by Personal Assistant — BUILD HELD until Commander authorizes a slice

MISSION

Implement FILL TERRA Waves 1–3 from the CURRENT implementation truth.

Do NOT replay research.
Do NOT treat RESEARCH DONE as IMPLEMENTED.
Do NOT rebuild already-present adapters.
Do NOT create Terra2.
Do NOT redo Phase 0 auth.
Do NOT fake coverage.
Do NOT scrape.
Do NOT push/commit/deploy/package unless explicitly authorized by Commander.

==================================================
SOURCE OF TRUTH
==================================================

CANONICAL IMPLEMENTATION SOURCE:

Nebula:
live-council-intelligence-repair
HEAD = 10a3d34 or newer descendant

DO NOT BUILD FROM:
GitHub main @ 822c333

Reason:
main lacks already-present OHGO / Caltrans / 511NY work.

DO NOT RE-ADD:

OHGO
Caltrans
existing 511NY adapter
existing GIBS stack
existing regional ON/QC/HK/Digitraffic integrations
existing USGS
existing partial EONET
existing current coverageFederation

==================================================
CURRENT IMPLEMENTATION TRUTH
==================================================

AUTH:
PUBLIC / PROVIDER_AUTH / COMMANDER_PRIVATE = ACTIVE

GOD'S EYE:
ACTIVE_WITH_GAPS

CAMERA FEDERATION:
PARTIAL

STRICT IMPLEMENTATION DONE ROWS:
NONE

RESEARCH STATUS:

Wave 1 research = READY / PARTIAL depending row
Wave 2 research = DONE
Wave 3 research = DONE

Wave research completion DOES NOT equal implementation completion.

==================================================
CURRENT SOURCE STATE
==================================================

SOURCE PRESENT:

coverageFederation
OHGO
Caltrans
Digitraffic / Ontario / Québec / Hong Kong
511NY gated provider-auth path
wzdx_kytc zones (NOT KYTC camera stills)
wsdot zones (NOT WSDOT Cameras.json)
NWS alerts partial
USGS
EONET partial
GIBS imagery stack

SOURCE MISSING:

KYTC TRIMARC stills
MRMS
NDDOT
WSDOT Cameras.json
Singapore traffic-images
NZTA cameras
Iceland cameras
Trafikverket Sweden
AZ511 camera adapter
Spain DGT
Catalonia SCT
GDACS
EPA RadNet
NRC Event Notifications
IAEA news link-out
NASA FIRMS
AWC METAR
full coverage-router UX

==================================================
RUNTIME TRUTH
==================================================

DEV 3001 = DOWN

INSTALLED:
3848 UI = UP
3847 Core = UP

health = 200 degraded

Without Commander session:

coverage-state = 401
live-intel = 200 AUTH_REQUIRED
weather = 401

Therefore:

OHGO = SOURCE PRESENT / RUNTIME RE-PROVE REQUIRED
Caltrans = SOURCE PRESENT / RUNTIME RE-PROVE REQUIRED
GIBS = SOURCE PRESENT / RUNTIME RE-PROVE REQUIRED
511NY = SOURCE PRESENT / PROVIDER_AUTH / RUNTIME UNVERIFIED

Do not call them LIVE again until re-proven in installed 3848 with session where needed.

==================================================
IMPLEMENTATION ORDER
==================================================

Execute in this order:

WAVE 1 P0
1. Coverage Router UX
2. KYTC TRIMARC still cameras
3. NWS CAP Severe+ toast → flyTo → drawer
4. MRMS ImageryLayer
5. 511NY provider-auth finish
6. Re-prove OHGO / Caltrans / GIBS on installed 3848

WAVE 2
7. Keyless camera densification:
   - WSDOT Cameras.json
   - NDDOT
   - Singapore
   - NZTA
   - Iceland
   - verify Digitraffic Finland
8. Wave 2 hazard/aviation:
   - USGS empty/truth states
   - FIRMS
   - AWC METAR
   - IAEA link-out
   - RadNet when ready
   - NRC only when egress clears

WAVE 3
9. Spain DGT
10. Catalonia SCT
11. GDACS
12. EONET completion / envelope cleanup

WAVE 4
only after:
keys
legal
egress
new lawful evidence

==================================================
WAVE 1 P0 — COVERAGE ROUTER
==================================================

CURRENT:
PARTIAL

Existing:
coverageFederation
bbox truth
some provider coverage metadata

MISSING:

- full mute UI for non-covering providers
- auto-enable covering providers
- Nearby cameras = covering providers only
- Cincinnati = Ohio + Kentucky coverage union
- yellow only when covering provider is empty / zero Online
- city-level acceptance tests
- foreign-region providers muted in Ohio

REQUIRED:

Provider registry must express lawful coverage envelope.

When active location changes:

covering providers:
ACTIVE / ELIGIBLE

non-covering providers:
MUTED / NOT_COVERING

Nearby camera query:
must query/filter covering providers only

Do NOT display:

Ontario
Québec
Hong Kong

as covering Akron/Cincinnati.

CINCINNATI:

covering camera federation must include:
OHGO
KYTC

Centracs / OKI:
NO_COVERAGE

No fake city cameras.

ACCEPTANCE LOCATIONS:

Akron, Ohio
Cincinnati, Ohio/Kentucky
California
New York
Spain
Catalonia
Singapore

Return:

COVERAGE_ROUTER = DONE only if:
- provider coverage classification works
- Nearby respects it
- mute UI works
- yellow semantics correct
- foreign providers stay muted outside coverage

==================================================
WAVE 1 P0 — KYTC
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Important:

existing wzdx_kytc != KYTC camera stills

Implement separate KYTC camera provider.

Use:

KYTC RealTime / TrafficCameras
TRIMARC HTTPS JPEG stills

Do NOT use:
dead WGS84WM HTTP 404 path

Requirements:

provider adapter
catalog
coverage envelope
real JPEG
attribution
truthful empty/error states
Cincinnati south-bank densification

No scrape.

==================================================
WAVE 1 P0 — NWS CAP
==================================================

STATUS:
PARTIAL

Existing:
NWS alerts layer

MISSING:
Severe+ interaction UX

Required:

api.weather.gov/alerts
proper User-Agent

Severe / Extreme:
toast
→ VIEW
→ flyTo real geometry/bbox
→ weather drawer

Avoid double-spam with Media/NWS logic.

Do not fabricate geometry.

Reuse existing alert truth lifecycle.

==================================================
WAVE 1 P0 — MRMS
==================================================

STATUS:
MISSING

Implement:

Mesonet MRMS / documented lawful radar path

Cesium ImageryLayer
over existing GIBS/base

Truth:

STREAM_ONLY
real frame timestamp
real attribution
polite cache
no fake radar
no particles-as-measured-weather

If unavailable:
truthful stale/error/no-coverage state

==================================================
WAVE 1 P0 — 511NY
==================================================

STATUS:
SOURCE PRESENT
PROVIDER_AUTH
RUNTIME UNVERIFIED

Finish:

official stills

VideoUrl:
link-out only

Credential:
provider-auth model

Commander supplies key outside chat.

Do not expose key client-side.

Re-prove in installed 3848 once configured.

==================================================
WAVE 1 P0 — RE-PROVE BASELINE
==================================================

After Wave 1 implementation:

prove installed 3848:

OHGO
Caltrans
GIBS

Do not rely on source presence.

Return for each:

SOURCE_PRESENT =
REGISTERED =
COVERAGE_ROUTED =
RUNTIME_REACHABLE =
REAL_DATA =
UI_CONNECTED =
TRUTH_STATE =

==================================================
WAVE 2 — KEYLESS CAMERAS
==================================================

Implement in this order:

1. WSDOT
2. NDDOT
3. Singapore
4. NZTA
5. Iceland
6. verify Digitraffic Finland existing state

--------------------------------------------------
WSDOT
--------------------------------------------------

Research-proven:

https://data.wsdot.wa.gov/mobile/Cameras.json

~1705 camera records

real stills:
images.wsdot.wa.gov

Implement:
PUBLIC
Washington coverage only
real image truth
attribution

Do not confuse with existing WSDOT zones work.

--------------------------------------------------
NDDOT
--------------------------------------------------

Research-proven:

geojson_nc/cameras.json
FullPath JPEG pattern

Implement:
PUBLIC
North Dakota coverage only
real JPEG verification
truthful empty/error

--------------------------------------------------
SINGAPORE
--------------------------------------------------

Research-proven:

api.data.gov.sg/v1/transport/traffic-images

Implement:
PUBLIC
Singapore coverage only

--------------------------------------------------
NZTA
--------------------------------------------------

Research-proven:

journeys cameras.json
trafficnz.info/camera/{id}.jpg

~313

Respect NZTA terms.

Implement:
PUBLIC where allowed
NZ-only coverage

--------------------------------------------------
ICELAND
--------------------------------------------------

Research-proven:

gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1

Slod JPEG fields

~500

Implement:
PUBLIC
Iceland coverage

--------------------------------------------------
DIGITRAFFIC FINLAND
--------------------------------------------------

Existing Finland support may already be present.

Do NOT duplicate.

Audit first.

If missing/incomplete:
use weathercam API
real preset JPEG:
weathercam.digitraffic.fi/{preset}.jpg

==================================================
WAVE 2 — KEYED CAMERA PROVIDERS
==================================================

TRAFIKVERKET SWEDEN:
PUBLIC_KEY
research-proven JPEG path

AZ511:
keyed
adapter currently missing
implement provider-auth path

Do not call BLOCKED simply because adapter is missing.

==================================================
WAVE 2 — HAZARD / AVIATION
==================================================

USGS:
SOURCE PRESENT
verify truth/empty states
do not duplicate adapter

FIRMS:
NASA FIRMS
MAP_KEY
adapter missing
requires disclaimer
no fake fire markers

AWC METAR:
JSON
research ready
implement aviation envelope

IAEA:
NEWS link-out only
do not map as nuclear hazard geometry

RADNET:
EPA station data
implement only when source/runtime proof is sufficient

NRC EVENT NOTIFICATIONS:
BLOCKED_EGRESS until proven reachable

Do not fake around blocked egress.

==================================================
WAVE 2 — HOLD / BLOCKED
==================================================

BLOCKED / PARTIAL:

NRC EN
DriveBC JPEG/TLS
FIRMS without MAP_KEY

HOLD:

PA
MI
Ohio Turnpike
TfNSW
UK National Highways
INDOT
MnDOT
FL511 SOAP
Travel-IQ without keys
CARS without keys
Duke until Legal clears
RainViewer commercial default

Do NOT reopen without new lawful evidence.

==================================================
WAVE 3 — DGT
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Spain DGT:

camaras.json
~1918 proven JPEG records

Implement:
PUBLIC
Spain coverage
real JPEG
attribution
truthful error/empty

==================================================
WAVE 3 — CATALONIA SCT
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Catalonia SCT:

WFS
RenderService
~328

Implement separately.

Score:

cameras_EU =
DGT ∪ SCT

Do NOT double-count SCT cameras as DGT cameras.

==================================================
WAVE 3 — GDACS
==================================================

STATUS:
RESEARCH READY
IMPLEMENTATION MISSING

Use:

events4app GeoJSON

Purpose:
multi-hazard / Live Intel

Do NOT count GDACS as haz_nuclear.

Implement:
feed normalization
real geometry
source/provenance
truthful lifecycle

==================================================
WAVE 3 — EONET
==================================================

STATUS:
PARTIAL

Existing EONET layer/source present.

Audit before changing.

Complete only missing:

normalization
coverage/envelope
Live Intel/hazard integration
truth states

Do NOT duplicate existing feed.

Do NOT count EONET as haz_nuclear.

==================================================
WAVE 3 — CTBTO
==================================================

STATUS:
CONFIRMED_UNFILLABLE

Public Terra feed:
NO

NDC / vDEC access model only

Do not ingest.
Do not scrape.
Do not create fake nuclear coverage.

==================================================
WAVE 4 BACKLOG
==================================================

Do not block Waves 1–3 on these.

CARS keys
NRC egress
RadNet completion
Korea ITS
Duke Legal
Travel-IQ
i-TRAFFIC ZA
LatAm/Africa/ME lawful feeds
broader EU
Live Intel RSS
ReliefWeb appname
US 511 triage
DriveBC JPEG proof
per-envelope gap closure

==================================================
OTHER OPEN TERRA GAPS
==================================================

These are NOT part of Waves 1–3 camera/hazard implementation unless explicitly needed:

local news
GPS
click→info
building ownership/inspect
street intelligence
remaining gaps priorities 4–8

Keep them separate.

==================================================
LIVE INTEL LANE
==================================================

PROMPT READY:

LIVE_INTEL_PANEL_REVAMP_EXECUTION_PROMPT_FINAL.md

BUILD HELD unless Commander explicitly opens it.

Local news still PARTIAL.

Do not merge this lane into camera provider implementation.

==================================================
LUXURY WEATHER LANE
==================================================

PROMPT READY:

TERRA_LUXURY_WEATHER_EXECUTION_PROMPT_FINAL.md

BUILD HELD unless Commander explicitly opens it.

Measured:
GIBS
future MRMS

Particles:
presentation only
not measured weather

==================================================
MEDIA LANE
==================================================

WAR ROOM MEDIA is separate.

Do NOT merge Media Player into Terra.

Media launcher may remain in War Room shell/rail according to existing product design.

No autoplay.

==================================================
AUTH RULES
==================================================

PUBLIC:
no Commander auth requirement for public Earth data

PROVIDER_AUTH:
server-side provider credentials

COMMANDER_PRIVATE:
private Commander data/location

OHGO:
PROVIDER_AUTH

511NY:
PROVIDER_AUTH

Do NOT force Commander session requirements onto lawful public Earth layers.

==================================================
COVERAGE SCORECARD
==================================================

Report coverage per envelope ONLY.

Use:

cameras_US
cameras_CA
cameras_EU
cameras_APAC
cameras_LatAm_ME_AF

weather_CONUS
weather_global

haz_quakes
haz_fire
haz_storm
haz_nuclear
haz_multihazard

maritime
aviation
places
outage
live_intel

No composite "Terra 90%" claim.

Each denominator must be explicit.

Remainder statuses:

DONE
PARTIAL
HOLD
BLOCKED_EGRESS
CONFIRMED_UNFILLABLE

==================================================
REFUSE
==================================================

NO:

scraping
fake camera markers
fake radar
fake nuclear maps
fake plume modeling
Google imagery ripping
USIE
DIY explosion classifier
CTBTO bot
HOLD reopening without new API
RainViewer commercial default without clearance
particles represented as measured weather
War Room Media merged into Terra
invented cameras for HTML portals
DGT/SCT double-counting
GDACS/EONET/USGS counted as nuclear
Terra2
Phase 0 auth rewrite
fake 90%
provider coverage outside real region

==================================================
IMPLEMENTATION DISCIPLINE
==================================================

For every provider/slice:

1. audit existing source first
2. do not duplicate existing adapters
3. implement smallest lawful slice
4. registry
5. coverage envelope
6. normalization
7. auth model
8. health/truth states
9. real data proof
10. UI connection
11. installed 3848 proof where possible

Do not call DONE because:
file exists
adapter compiles
research found endpoint

DONE requires runtime truth.

==================================================
COMMIT / PUSH / PACKAGE RULE
==================================================

Until Commander explicitly authorizes:

NO COMMIT
NO PUSH
NO DEPLOY
NO PACKAGE
NO REINSTALL

Implementation may occur only for Commander-approved slice.

If this prompt is being used for planning/audit only:

DO NOT MODIFY FILES.

==================================================
RETURN FORMAT
==================================================

FILL_TERRA_IMPLEMENTATION_REPORT

CANONICAL_SOURCE =
SOURCE_HEAD =

WAVE_1 =
COVERAGE_ROUTER =
KYTC =
NWS_CAP =
MRMS =
511NY =

BASELINE_REPROOF =
OHGO =
CALTRANS =
GIBS =

WAVE_2 =
WSDOT =
NDDOT =
SINGAPORE =
NZTA =
ICELAND =
DIGITRAFFIC_FI =
TRAFIKVERKET_SE =
AZ511 =

USGS =
FIRMS =
AWC_METAR =
RADNET =
NRC_EN =
IAEA =

WAVE_3 =
DGT =
SCT =
GDACS =
EONET =
CTBTO =

WAVE_4_BACKLOG =

COVERAGE_SCORECARD =

HOLD =
BLOCKED =
UNFILLABLE =

SOURCE_STATUS =
DEV_STATUS =
INSTALLED_3848_STATUS =

FILES_CHANGED =
VALIDATIONS =
RUNTIME_PROOF =
VISUAL_PROOF =
SCREENSHOT_PATHS =

NEXT_REQUIRED_SLICE =

OVERALL =

STOP.

# ========== PART F — MERGED FILL TRUTH (main vs Nebula) ==========

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