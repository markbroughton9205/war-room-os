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
