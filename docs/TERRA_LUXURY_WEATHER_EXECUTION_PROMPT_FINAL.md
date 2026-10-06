# TERRA LUXURY WEATHER EFFECT + NOTIFICATIONS — EXECUTION PROMPT (FINAL)
# Commander: Mark | War Room Research + PA co-lead | 2026-09-16/17
# Align TERRA_GAPS_CURRENT_DELTA_EXECUTION.md — do NOT reopen Phase 0 auth rewrite

## BEST PATH
1) RECON return-first: GIBS layer IDs + any ImageryLayer/CAP/OHGO-weather hooks → STOP
2) NWS CAP PUBLIC alerts → severity-throttled toast (Severe+) → flyTo bbox → detail drawer
3) Truth overlay: Iowa Mesonet MRMS (US, polite cache) OR RainViewer only if Mark's use = personal/edu (else commercial clearance / paid OWM) as ImageryLayer; GIBS stays base; attribution on
4) Lux: ONE camera-tied ParticleSystem (soft rain/snow) driven by radar/CAP intensity — presentation only, never "measured"; reduced-motion / high altitude = radar+polygons only
5) Outages: NWS-related + utility link-out; Duke Energy public ArcGIS candidate if fields/ToS cleared; no HTML scrape
6) Optional Media CAP duck reuse (same severity gate) — don't double-spam

## REFUSE
Fake radar · Google weather rip · scrape AEP/FE/PowerOutage.us · claim particles as measured weather · RainViewer as commercial WR default without clearance · melt IEM · sound/toast spam · Phase 0 auth reopen · merge Media Player radio into weather · permanent huge weather sidebar

## MISSION
Add a luxurious weatherman-style weather layer to Terra/Cesium with notifications and a detail panel for live weather + outages. Research lock 2026-09-16 (War Room Research + PA co-lead). Build only with Commander go. Globe stays hero. CURRENT DELTA: do NOT reopen Phase 0 auth rewrite. Public Earth feeds stay public. Media Player = separate module.

## LAYER TRUTH MODEL
- MEASURED STREAM_ONLY: NASA GIBS (base, already ACTIVE), radar tiles (Mesonet MRMS and/or RainViewer), NWS CAP polygons/text
- PRESENTATION ONLY: Cesium ParticleSystem rain/snow/lightning accents — never labeled as instrument truth
- Provenance + attribution always visible on measured layers

## LICENSE GATES
- GIBS: PUBLIC STREAM_ONLY — keep as base drape
- Iowa State Mesonet MRMS/RIDGE TMS: public-domain materials + NOAA acknowledge; STREAM_ONLY; polite cache; don't overload IEM (mesonet.agron.iastate.edu/ogc/)
- RainViewer public maps API (api.rainviewer.com/public/weather-maps.json): PERSONAL_OK/EDUCATIONAL, attribution required, STREAM_ONLY, ~2h history / ~10-min frames — NOT free commercial SLA. Use as default ONLY if Commander confirms personal/edu; else get commercial clearance OR use Mesonet (US) / paid OpenWeatherMap tiles
- NWS api.weather.gov/alerts (+ CAP): PUBLIC; User-Agent required
- Outages: prefer NWS outage-related alerts + link-out to utility portals. Duke Energy public ArcGIS FeatureServer is a CANDIDATE ingest after field+ToS check. AEP Ohio / FirstEnergy / PowerOutage.us HTML = REFUSE scrape unless official API

## PHASE 0 — RECON (return-first)
Map existing Terra GIBS ImageryLayer IDs, any CAP/alert hooks, OHGO road-weather (note: cams ≠ cinematic radar). Report WEATHER_RECON. STOP for Commander review.

## PHASE 1 — Alerts + notification UX
Poll NWS alerts (start area=OH; design for global bbox later). User-Agent required.
Toast only Severe+ (or Commander threshold) with honesty label + provenance.
On click/go: Cesium flyTo alert bbox → detail drawer: alert text, onset/expires, links, radar timestamp, outage section (link-out or cleared Duke layer).
Optional: reuse Media CAP audio duck at same severity — never double-spam toast+duck+sound.
Acceptance: Severe+ toast→flyTo→drawer works; Minor/Moderate default no toast; AUTH_FAIL ≠ NO_COVERAGE.

## PHASE 2 — Measured radar overlay
Add ImageryLayer radar on top of GIBS:
- Primary US: Mesonet MRMS/RIDGE TMS with polite cache + attribution
- Optional global/personal: RainViewer tiled frames if license gate allows
Animate recent frames for weatherman scrub; soft opacity (~0.35–0.55).
Acceptance: real tiles only; attribution visible; no invented reflectivity; GIBS still base.

## PHASE 3 — Luxury presentation (particles)
ONE ParticleSystem (rain/snow switch) in camera frustum; wind updateCallback; rate from radar/CAP intensity bins; restrained lightning optional (hard throttle).
Pause/destroy at high altitude or when weather card inactive.
prefers-reduced-motion OR Commander toggle → radar + CAP polygons only (no particles/lightning).
Acceptance: particles never labeled as measured; GPU stable on RTX 5060-class (target ~2k–8k particles in view); reduced-motion path works.

## PHASE 4 — Outages section
Drawer section: NWS outage-related alerts + deep link to utility outage map.
If Duke public FeatureServer cleared: optional overlay with provenance; else link-out only.
Acceptance: no scraped HTML; no fake outage polygons.

## PHASE 5 — Live Intel / EARTH tie-in
Weather/alert cards can surface in Live Intel EARTH category with same provenance/honesty; mediaPreview rules from Live Intel lock apply if video/thumbs added later — no scrape.
Acceptance: EARTH intel + weather drawer stay consistent; globe readable.

## GLOBAL ACCEPTANCE
- Measured vs presentation visually/documented distinct
- License gate enforced for RainViewer commercial
- No fake coverage; health labels honest
- Globe remains hero
- Merge/push only with Commander approval
