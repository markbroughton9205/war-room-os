# FILL TERRA — ALL WAVES COMBINED EXECUTION PROMPT
# Commander: Mark | Waves 1–3 research lock 2026-09-17 | Personal Assistant synthesis
# Research-only until Commander says implement. CURRENT DELTA authoritative.
# Auth split ACTIVE: PUBLIC | PROVIDER_AUTH | COMMANDER_PRIVATE
# No Terra2. No Phase 0 auth rewrite. No fake 90% / fake coverage.
# No commit/push/deploy without Commander authorization.

## MISSION
Fill Terra coverage debt with maximum lawful sources. Implement only Commander-approved slices.
Wave1 P0 is always first when builds reopen; then Wave2 proven adds; then Wave3 proven adds.
Scorecard = per-envelope only (cams_US, cams_global, wx, haz_*, maritime, aviation, places, outages, haz_nuclear). Never fake composite 90%.

## BASELINE LIVE (already in product / proven)
- OHGO (OH cams/events/road weather) LIVE
- Caltrans LIVE
- GIBS LIVE
- Ontario 511 / Québec 511 / Hong Kong TD / Digitraffic lineage = LIVE regional (do not use outside coverage)

## WAVE 1 — P0 ORDER (implement first)
1) Coverage router — bbox/admin registry; auto-enable covering providers; mute non-covering; Nearby queries covering only; yellow only if covering empty or zero Online cams
2) KYTC RealTime — ArcGIS TrafficCameras Online + TRIMARC HTTPS JPEG; NOT WGS84WM http 404; attribution KYTC/TRIMARC; Cincy south-bank densify
3) NWS CAP — api.weather.gov/alerts; User-Agent; Severe+ toast→flyTo→drawer; reuse Media CAP severity; no double-spam
4) Mesonet MRMS — ImageryLayer on GIBS; STREAM_ONLY; polite cache; attribution
5) 511NY stills finish — official stills; VideoUrl link-out only; needs provider credential

## WAVE 2 — PROVEN ADDS (after Wave1 P0)
### CAM P0 keyless stills
- WSDOT: https://data.wsdot.wa.gov/mobile/Cameras.json + images.wsdot.wa.gov (~1705 JPEG proven)
- NDDOT: geojson_nc/cameras.json + FullPath JPEG pattern
- Singapore: api.data.gov.sg/v1/transport/traffic-images
- NZ: journeys cameras.json + trafficnz.info/camera/{id}.jpg (NZTA ToS)
- Iceland: gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1 + Slod JPEGs (~500)

### CAM P1 keyed
- Digitraffic FI weathercam (gzip) + weathercam.digitraffic.fi/{preset}.jpg (~809)
- Trafikverket SE (PUBLIC_KEY) + proven JPEG path
- AZ511 (PUBLIC_KEY) docs READY
- 511 Alberta / Manitoba (PUBLIC_KEY; GET not HEAD) — live keys → Wave 3/4 if not proven
- COtrip (signup) → prove after key

### HAZ / AV / OUTAGE
- USGS quakes GeoJSON — READY
- NASA FIRMS (MAP_KEY + disclaimer) — READY
- AWC METAR JSON — READY
- Nuclear: EPA RadNet stations READY; NRC Event Notifications PARTIAL (egress 403 → later wave); IAEA NEWS = REPORTED link-out only; refuse USIE / DIY nuke maps / fake plumes
- Duke FeatureServer outages = link-out default until Legal clears ToS gray

## WAVE 3 — FOLDED / PARTIAL (include if proven; else Wave 4)
Known folds (research): Spain DGT · GDACS · EONET · Catalonia SCT (P0 candidate)
Still open / rolled forward if not byte-proven: CARS AB/MB/SK/NS/NL keys · NRC egress · Duke Legal · Travel-IQ gated US states · Korea ITS · CTBTO public URL · LatAm/Africa/ME DOTs · broader EU DATEX/HTML triage · Live Intel source families

(When implementing, only ship Wave 3 rows marked JPEG/API proven; treat unproven as WAVE4.)

## HOLD (do not reopen without new API)
PA · MI · Ohio Turnpike · TfNSW · DriveBC TLS · UK NH · FL511 SOAP · Travel-IQ without key (ID/NV/UT/LA/OR/AK class) · MD CHART HTML video · many EU DATEX/HTML · Norway Vegvesen until stills grant

## CONFIRMED_UNFILLABLE
- TxDOT plain public stills — no stable API
- DelDOT legacy XML 404
- Cincy streets / Centracs / OKI — private / no public API (honest NO_COVERAGE)

## CINCINNATI RULE
ON/HK/QC yellow at Cincy = correct. Densify with OHGO + KYTC. Never pretend foreign regionals cover Ohio. City Centracs/OKI stay honest empty until public API or Commander-private capture.

## SCORECARD RULES
Report % per envelope. haz_nuclear separate. Document HOLD / UNFILLABLE / WAVE4. Never invent markers to hit 90%.

## REFUSE
Scrape · fake markers/radar/nuke maps · USIE · DIY explosion classifier · Google rip · HOLD reopen without new API · RainViewer as commercial default without clearance · particles as measured weather · Media Player merge into Terra · invent cams for NO_COVERAGE · WAF bypass · Phase 0 auth rewrite · Terra2

## RETURN FIRST (when builds reopen)
1) WAVE_COMBINED_MATRIX statuses: DONE|PARTIAL|HOLD|UNFILLABLE|WAVE4 for every row above
2) Proposed file touch list for Commander-approved slice only
3) STOP unless Commander says implement

## OPTIONAL WAVE 4 BACKLOG (after Wave 3 stamp)
CARS live keys · NRC egress · Duke Legal · Travel-IQ keyed states · Korea ITS · CTBTO · LatAm/Africa/ME DOTs · EU stills vs UNFILLABLE · Live Intel densify
