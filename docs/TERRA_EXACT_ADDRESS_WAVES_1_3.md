# TERRA EXACT ADDRESS — WAVES 1–3 RESEARCH
# Commander: Mark
# Mode: RESEARCH ONLY — no code edits
# Date: 2026-09-19 (America/New_York)
# Case example: 936 Springdale St, Akron, OH (privacy: coordinates/address only; no owner/resident names)

Legend for every claim:
- **VERIFIED FACT** = confirmed from official docs or live public API test this session
- **VENDOR CLAIM** = marketing / product page claim not independently proven
- **INFERENCE** = reasoned conclusion from verified facts
- **RECOMMENDATION** = product guidance for Terra

Rooftop vs interpolated (definitions used throughout):
- **ROOFTOP / ADDRESS POINT** = coordinate tied to a real mapped address feature (building, parcel centroid, entry, or surveyed address point) — existence of that address is asserted by the source
- **INTERPOLATED** = house number mathematically placed along a street centerline / address range — may not exist; position is approximate on the road, not the building

---

# WAVE 1 — GEOCODER SEMANTICS MATRIX

## 1.1 Nominatim (OSM + optional US TIGER)

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes when OSM `addr:housenumber` exists; else may fall back to street or TIGER/OSM interpolation | VERIFIED FACT |
| ROOFTOP_SUPPORT | Only if mapped as address node/building; OSM `class=place`/`type=house` can still be TIGER **interpolation** | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | Yes — OSM address points when present | VERIFIED FACT |
| INTERPOLATION | Yes — OSM `addr:interpolation` lines + US TIGER address ranges (explicitly approximate) | VERIFIED FACT |
| PARCEL_SUPPORT | No | VERIFIED FACT |
| CONFIDENCE_FIELD | No numeric confidence; use `class`/`type`/`osm_type`/`importance` | VERIFIED FACT |
| MATCH_TYPE | Implicit via result class (`house`, `highway`, etc.) and place_rank; osmline/TIGER = interpolation | VERIFIED FACT |
| COMMERCIAL_USE | Public OSMF instance: allowed for moderate end-user triggered use; heavy/commercial products must self-host or use third party | VERIFIED FACT |
| CACHE_RULES | Aggressive caching required; bulk/systematic discouraged; ≤1 req/s | VERIFIED FACT |
| DISPLAY_RESTRICTIONS | OSM / ODbL attribution required | VERIFIED FACT |
| SELF_HOSTABLE | Yes | VERIFIED FACT |
| GLOBAL_COVERAGE | Yes (OSM-dependent) | VERIFIED FACT |
| US_ACCURACY | Spotty housenumbers; TIGER often returns interpolated “house” that is **not** rooftop | VERIFIED FACT |
| KNOWN_LIMITATIONS | Public instance capacity limits; no autocomplete; Springdale-class queries often land STREET-only when housenumber not in OSM | VERIFIED FACT |

Docs: https://nominatim.org/release-docs/develop/library/Result-Handling/  
Policy: https://operations.osmfoundation.org/policies/nominatim/

**Why STREET — APPROXIMATE happens (INFERENCE):** For many US residential streets, OSM lacks `addr:*` nodes. Nominatim then returns the road geometry (or interpolates). A typed house number does not force rooftop.

---

## 1.2 Photon (Komoot / OSM via Nominatim export)

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes via `/structured?housenumber=&street=` when indexed | VERIFIED FACT |
| ROOFTOP_SUPPORT | Only if underlying OSM/Nominatim document is an address point | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | Yes when present in index | VERIFIED FACT |
| INTERPOLATION | Inherited from Nominatim import / expanded interpolations in Photon pipeline | VERIFIED FACT |
| PARCEL_SUPPORT | No | VERIFIED FACT |
| CONFIDENCE_FIELD | Relevance score in search; not a precision class | VERIFIED FACT |
| MATCH_TYPE | Implicit via `osm_key`/`osm_value`/`housenumber` presence | VERIFIED FACT |
| COMMERCIAL_USE | Self-hostable; public photon.komoot.io is courtesy capacity | INFERENCE |
| CACHE_RULES | Follow instance ToS; self-host preferred for product | INFERENCE |
| DISPLAY_RESTRICTIONS | OSM attribution | VERIFIED FACT |
| SELF_HOSTABLE | Yes | VERIFIED FACT |
| GLOBAL_COVERAGE | Yes (OSM) | VERIFIED FACT |
| US_ACCURACY | Same OSM gaps; ranking can prefer more popular similar street names | VERIFIED FACT (prior context + docs) |
| KNOWN_LIMITATIONS | Abbreviations like Ave/Str. imperfect; state ambiguity; can rank **Springdale Drive** above **Springdale Street** | VERIFIED FACT (prior Terra context) |

Docs: https://github.com/komoot/photon/blob/master/docs/api-v1.md  
Structured: https://github.com/lonvia/photon/blob/master/docs/structured.md

---

## 1.3 Pelias (+ Geocode Earth hosted)

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes | VERIFIED FACT |
| ROOFTOP_SUPPORT | OpenAddresses / OSM address **points** are point geometry — not guaranteed rooftop | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | Yes — `source=openaddresses` / `openstreetmap`, `layer=address` | VERIFIED FACT |
| INTERPOLATION | Yes — `match_type=interpolated` using OA/OSM + US TIGER ranges | VERIFIED FACT |
| PARCEL_SUPPORT | No (unless separately loaded) | VERIFIED FACT |
| CONFIDENCE_FIELD | `confidence` 0–1 | VERIFIED FACT |
| MATCH_TYPE | `exact` \| `interpolated` \| `fallback` | VERIFIED FACT |
| COMMERCIAL_USE | Self-host free (data licenses apply); Geocode Earth is commercial hosted | VERIFIED FACT |
| CACHE_RULES | Self-host: own policy; Geocode Earth: vendor ToS | INFERENCE |
| DISPLAY_RESTRICTIONS | Source attribution (OSM/OA/WOF) | VERIFIED FACT |
| SELF_HOSTABLE | Yes | VERIFIED FACT |
| GLOBAL_COVERAGE | Multi-source; gaps where OA/OSM thin | VERIFIED FACT |
| US_ACCURACY | Strong when OA county feed exists; else interpolates | VERIFIED FACT |
| KNOWN_LIMITATIONS | `accuracy=point` ≠ rooftop; `fallback` can return street/city | VERIFIED FACT |

Docs: https://github.com/pelias/documentation/blob/master/result_quality.md  
Addresses: https://github.com/pelias/documentation/blob/master/addresses.md  
Geocode Earth example: https://geocode.earth/docs/reference/response_format/

**CRITICAL (VERIFIED FACT):** Pelias explicitly separates **match quality** (`match_type`) from **geometry kind** (`accuracy`: point vs centroid). Terra must do the same.

---

## 1.4 OpenAddresses (dataset, not a live geocoder)

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes — authoritative address points | VERIFIED FACT |
| ROOFTOP_SUPPORT | Point location quality varies by source (building / parcel / road) | VERIFIED FACT (Overture notes same issue for OA-derived points) |
| ADDRESS_POINT_SUPPORT | Primary product | VERIFIED FACT |
| INTERPOLATION | No (points are source addresses) | VERIFIED FACT |
| PARCEL_SUPPORT | Separate parcel layers where sources publish them | VERIFIED FACT |
| CONFIDENCE_FIELD | N/A (raw data) | VERIFIED FACT |
| MATCH_TYPE | N/A — consumer must match | VERIFIED FACT |
| COMMERCIAL_USE | Per-source license (not relicensed by OA) | VERIFIED FACT |
| CACHE_RULES | Download/batch; GeoJSON free; custom export for backers | VERIFIED FACT |
| DISPLAY_RESTRICTIONS | Per source JSON license | VERIFIED FACT |
| SELF_HOSTABLE | Yes — download + index | VERIFIED FACT |
| GLOBAL_COVERAGE | Partial; US Midwest collection exists | VERIFIED FACT |
| US_ACCURACY | High where county publishes; Summit OH sourced | VERIFIED FACT |
| KNOWN_LIMITATIONS | Not a search API; freshness depends on county; license patchwork | VERIFIED FACT |

Portal: https://batch.openaddresses.io/data  
Summit source: https://github.com/openaddresses/openaddresses/blob/master/sources/us/oh/summit.json  
API: https://github.com/openaddresses/batch/blob/master/api/API.md

---

## 1.5 Overture Addresses theme

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes (`number`, `street`, …) | VERIFIED FACT |
| ROOFTOP_SUPPORT | **No guarantee** — points may be building centroids, entrances, road points, or parcel centroids | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | Yes — theme is address points (~472M, Aug 2026 release) | VERIFIED FACT |
| INTERPOLATION | Not an interpolating geocoder; points only | VERIFIED FACT |
| PARCEL_SUPPORT | Separate Overture themes; not in address feature | VERIFIED FACT |
| CONFIDENCE_FIELD | Source metadata; IDs not GERS-stable yet | VERIFIED FACT |
| MATCH_TYPE | N/A — consumer match | VERIFIED FACT |
| COMMERCIAL_USE | Per aggregated source licenses | VERIFIED FACT |
| CACHE_RULES | Cloud GeoParquet (S3/Azure); monthly releases | VERIFIED FACT |
| DISPLAY_RESTRICTIONS | Per-source attribution | VERIFIED FACT |
| SELF_HOSTABLE | Yes (download) | VERIFIED FACT |
| GLOBAL_COVERAGE | 39 countries; US partial (~125.8M US addresses) | VERIFIED FACT |
| US_ACCURACY | Large but incomplete; quality varies | VERIFIED FACT |
| KNOWN_LIMITATIONS | Alpha theme; unstable IDs; not a query API | VERIFIED FACT |

Docs: https://docs.overturemaps.org/guides/addresses/  
S3: `s3://overturemaps-us-west-2/release/2026-08-19.0/theme=addresses/type=address/*`

---

## 1.6 US Census Geocoder

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes against TIGER address ranges | VERIFIED FACT |
| ROOFTOP_SUPPORT | **No** — official docs: coordinates are **interpolated** | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | No (ranges on tigerLine) | VERIFIED FACT |
| INTERPOLATION | Always for location coordinates | VERIFIED FACT |
| PARCEL_SUPPORT | No | VERIFIED FACT |
| CONFIDENCE_FIELD | Match indicator Match/Tie/No_Match; Exact vs Non-Exact | VERIFIED FACT |
| MATCH_TYPE | Exact / Non-Exact + side L/R | VERIFIED FACT |
| COMMERCIAL_USE | Public government API; check current Census ToS | INFERENCE |
| CACHE_RULES | Reasonable use; batch ≤10k | VERIFIED FACT |
| DISPLAY_RESTRICTIONS | US Gov public data | INFERENCE |
| SELF_HOSTABLE | Use TIGER downloads; not full service clone | INFERENCE |
| GLOBAL_COVERAGE | US (+ PR options) only | VERIFIED FACT |
| US_ACCURACY | Good for census geography; **poor for rooftop** | VERIFIED FACT |
| KNOWN_LIMITATIONS | Ranges include possible-but-nonexistent numbers | VERIFIED FACT |

Docs: https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html  
API: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html

---

## 1.7 HERE Geocoding & Search

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes (`resultType=houseNumber`) | VERIFIED FACT |
| ROOFTOP_SUPPORT | `houseNumberType=PA` position **may** be rooftop, entry, driveway, or parking — not labeled “rooftop” exclusively | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | PA = Point Address from trusted sources | VERIFIED FACT |
| INTERPOLATION | `houseNumberType=interpolated` | VERIFIED FACT |
| PARCEL_SUPPORT | Not as primary match type | INFERENCE |
| CONFIDENCE_FIELD | Scoring / `estimatedPointAddress` flags (API evolution) | VENDOR CLAIM / docs |
| MATCH_TYPE | `resultType` + `houseNumberType` (PA / interpolated / MPA) | VERIFIED FACT |
| COMMERCIAL_USE | Paid API key | VERIFIED FACT |
| CACHE_RULES | Per HERE Terms (plan-dependent) | VENDOR CLAIM |
| DISPLAY_RESTRICTIONS | HERE attribution / ToS | VENDOR CLAIM |
| SELF_HOSTABLE | No (SaaS) | VERIFIED FACT |
| GLOBAL_COVERAGE | Strong commercial global | VENDOR CLAIM |
| US_ACCURACY | Strong PA coverage claimed | VENDOR CLAIM |
| KNOWN_LIMITATIONS | PA ≠ always rooftop; MPA restricted privilege | VERIFIED FACT |

Docs: https://docs.here.com/geocoding-and-search/docs/result-types-address

---

## 1.8 Mapbox Geocoding API v6

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes (`feature_type=address`) | VERIFIED FACT |
| ROOFTOP_SUPPORT | `coordinates.accuracy=rooftop` when intersects known building/entrance | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | `accuracy=point` | VERIFIED FACT |
| INTERPOLATION | `accuracy=interpolated` | VERIFIED FACT |
| PARCEL_SUPPORT | `accuracy=parcel` | VERIFIED FACT |
| CONFIDENCE_FIELD | `match_code.confidence` exact/high/medium/low | VERIFIED FACT |
| MATCH_TYPE | `match_code` per component + accuracy enum | VERIFIED FACT |
| COMMERCIAL_USE | Yes; Temporary vs Permanent storage | VERIFIED FACT |
| CACHE_RULES | Temporary: **must not cache**; Permanent: may store indefinitely (billing/contract) | VERIFIED FACT |
| DISPLAY_RESTRICTIONS | Mapbox ToS; responses may say not retain for temporary | VERIFIED FACT |
| SELF_HOSTABLE | No | VERIFIED FACT |
| GLOBAL_COVERAGE | Global (variable depth) | VENDOR CLAIM |
| US_ACCURACY | Explicit rooftop/parcel/interpolated labels — excellent for Terra truth states | VERIFIED FACT |
| KNOWN_LIMITATIONS | Must use with Mapbox maps per pricing note; autocomplete burns quota | VERIFIED FACT |

Docs: https://docs.mapbox.com/api/search/geocoding/

Accuracy enum (VERIFIED FACT): `rooftop` | `parcel` | `point` | `interpolated` | `approximate` | `intersection`

---

## 1.9 Smarty (US Street API)

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes + USPS DPV | VERIFIED FACT |
| ROOFTOP_SUPPORT | `metadata.precision=Rooftop` with US Rooftop Geocoding license | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | Parcel / Street / ZipN precision tiers | VERIFIED FACT |
| INTERPOLATION | Street precision = proportional along street | VERIFIED FACT |
| PARCEL_SUPPORT | `precision=Parcel` (centroid) | VERIFIED FACT |
| CONFIDENCE_FIELD | DPV + `enhanced_match` + precision | VERIFIED FACT |
| MATCH_TYPE | `match=strict\|invalid\|enhanced` | VERIFIED FACT |
| COMMERCIAL_USE | Paid subscription | VERIFIED FACT |
| CACHE_RULES | Coordinate license IDs (0 open / 1 proprietary limited) | VERIFIED FACT |
| DISPLAY_RESTRICTIONS | Product terms; proprietary coords may be internal-use only | VERIFIED FACT |
| SELF_HOSTABLE | No (cloud API) | VERIFIED FACT |
| GLOBAL_COVERAGE | US-focused (other products exist) | VERIFIED FACT |
| US_ACCURACY | Industry-leading USPS verification + optional rooftop | VENDOR CLAIM + docs |
| KNOWN_LIMITATIONS | Rooftop requires specific license; US-centric | VERIFIED FACT |

Docs: https://www.smarty.com/docs/apis/us-street-api/reference

---

## 1.10 TomTom

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes | VERIFIED FACT |
| ROOFTOP_SUPPORT | “Point Address” type; not always labeled rooftop | VERIFIED FACT |
| ADDRESS_POINT_SUPPORT | `idxSet=PAD` Point Address | VERIFIED FACT |
| INTERPOLATION | Address Range (`Addr`) when no PAD | VERIFIED FACT |
| PARCEL_SUPPORT | Not primary | INFERENCE |
| CONFIDENCE_FIELD | `matchConfidence.score` (textual match, not geometry precision) | VERIFIED FACT |
| MATCH_TYPE | Result `type`: Point Address / Address Range / Street | VERIFIED FACT |
| COMMERCIAL_USE | Paid API key | VERIFIED FACT |
| CACHE_RULES | TomTom developer ToS | VENDOR CLAIM |
| DISPLAY_RESTRICTIONS | ToS / attribution | VENDOR CLAIM |
| SELF_HOSTABLE | No | VERIFIED FACT |
| GLOBAL_COVERAGE | Strong commercial | VENDOR CLAIM |
| US_ACCURACY | Prefer PAD over Addr/Str | RECOMMENDATION |
| KNOWN_LIMITATIONS | Score ≠ rooftop proof | VERIFIED FACT |

Docs: https://developer.tomtom.com/geocoding-api/documentation/tomtom-orbis-maps/v1/geocode

---

## 1.11 Esri ArcGIS World Geocoding Service

| Field | Value | Class |
|---|---|---|
| HOUSE_NUMBER_SUPPORT | Yes | VERIFIED FACT |
| ROOFTOP_SUPPORT | `locationType=rooftop` (default) for PointAddress when available; DisplayX/Y often rooftop | VERIFIED FACT (docs synthesis) |
| ADDRESS_POINT_SUPPORT | `Addr_type=PointAddress` | VERIFIED FACT |
| INTERPOLATION | `StreetAddress` / range types | VERIFIED FACT |
| PARCEL_SUPPORT | Some locator types / local locators | INFERENCE |
| CONFIDENCE_FIELD | `score` 0–100 | VERIFIED FACT |
| MATCH_TYPE | `Addr_type` (PointAddress, StreetAddress, StreetName, …) | VERIFIED FACT |
| COMMERCIAL_USE | ArcGIS Online credits / enterprise | VERIFIED FACT |
| CACHE_RULES | Esri ToS / licensing | VENDOR CLAIM |
| DISPLAY_RESTRICTIONS | Esri attribution | VENDOR CLAIM |
| SELF_HOSTABLE | Enterprise locator possible | VERIFIED FACT |
| GLOBAL_COVERAGE | Strong | VENDOR CLAIM |
| US_ACCURACY | Excellent PointAddress where licensed data exists | VENDOR CLAIM |
| KNOWN_LIMITATIONS | Rooftop may be unavailable; street entry vs display coords differ | VERIFIED FACT |

Refs: https://developers.arcgis.com/rest/geocode/find-address-candidates/  
https://developers.arcgis.com/rest/geocode/api-reference/geocoding-service-output.htm

---

## 1.12 Wave 1 synthesis for Terra

| Provider | Honest precision labels? | Best role |
|---|---|---|
| Nominatim / Photon | Weak | Global fallback / street / place |
| Pelias + OA | Strong (`match_type`) | Self-hosted US address points |
| Census | Explicitly interpolated | Census geography only — never rooftop |
| Mapbox | Strongest open accuracy enum | Paid global with truth states |
| HERE / TomTom / Esri | Good type fields | Commercial PAD |
| Smarty | Strongest US rooftop + DPV | US verification + rooftop license |
| OA / Overture | Data, not API | Enrichment / sovereign index |

**RECOMMENDATION:** Never promote STREET or INTERPOLATED to ROOFTOP. Prefer providers that expose accuracy enums (Mapbox, Pelias match_type, HERE houseNumberType, Smarty precision).

---

# WAVE 2 — EXACT ADDRESS DATA SOURCES & US REFINEMENT CHAIN

## 2.1 Source inventory

### OpenAddresses
- Aggregates county/city address **points**, plus optional parcels/buildings/centerlines.
- Summit OH source wires county ArcGIS address points, building footprints, tax parcels.
- Download: https://batch.openaddresses.io/data
- Source JSON: https://raw.githubusercontent.com/openaddresses/openaddresses/master/sources/us/oh/summit.json

### Overture address theme
- Alpha; ~472M points (2026-08-19 release); US ~125.8M.
- Good for bulk enrichment; still need local matching engine.
- https://docs.overturemaps.org/guides/addresses/

### County / municipal address points (911 / LBRS)
- Ohio LBRS: county address points for NG9-1-1 style addressing.
- Statewide hosted: https://maps.ohio.gov/arcgis/rest/services/Hosted/Ohio_Statewide_LBRS_Address_Points/FeatureServer
- County downloads: https://gis1.oit.ohio.gov/geodatadownloadtable/lbrs.aspx (SUMMIT address points listed)
- Hub: https://ohiolbrs-geohio.hub.arcgis.com/

### Parcel centroids / polygons
- County tax parcel FeatureServers (Summit tested — Wave 3).
- Useful for PARCEL match + camera framing bounds.
- **Privacy:** do not request/display `OWNERNME*` fields for Terra navigation.

### Building footprints
- County footprints (Summit MapServer tested).
- Microsoft US Building Footprints / Overture buildings as secondary.
- Use for containment validation: address point ∈ building ⇒ BUILDING/ROOFTOP candidate.

### Commercial rooftop geocoders
- Smarty Rooftop, Mapbox `accuracy=rooftop`, HERE PA, Esri PointAddress+rooftop, TomTom PAD.

## 2.2 US refinement chain (RECOMMENDATION)

```
QUERY (parsed house + street + city + state + ZIP)
        │
        ▼
GEOCODER (global) ──► STREET / INTERPOLATED / ADDRESS / ROOFTOP
        │                 (truthful label only)
        ▼
ADDRESS POINT layer (county OA / LBRS / Overture)
        │  exact number + street type + ZIP
        ▼
PARCEL polygon (optional) ──► containment / centroid / bounds
        │
        ▼
BUILDING FOOTPRINT (optional) ──► containment / bbox framing
        │
        ▼
FINAL TARGET + MATCH_QUALITY
```

Rules:
1. Each stage may only **upgrade** precision with evidence; never invent rooftop.
2. Street-type tokens (ST vs DR) must match exactly after normalization.
3. If geocoder says INTERPOLATED but county address point exact-matches → prefer ADDRESS_POINT.
4. If address point inside building footprint → BUILDING (or ROOFTOP if provider says rooftop).
5. If only parcel polygon matches site address → PARCEL.
6. If nothing beyond geocoder street → STREET — APPROXIMATE (honest).

## 2.3 Why open geocoders return street (VERIFIED FACT + INFERENCE)
- OSM US residential `addr:*` coverage is incomplete.
- TIGER/Census ranges are centerline interpolations.
- Photon/Nominatim rank by name popularity → Springdale **Drive** can beat Springdale **Street**.
- Without county address points, house numbers cannot be proven.

---

# WAVE 3 — SUMMIT COUNTY / AKRON CASE STUDY

## 3.1 Public machine-readable endpoints (VERIFIED FACT — live tested 2026-09-19)

### A) Summit County Address Points (FeatureServer) — PRIMARY
- Service: https://scgis.summitoh.net/hosted/rest/services/Address/Address_Points/FeatureServer
- Layer 0: https://scgis.summitoh.net/hosted/rest/services/Address/Address_Points/FeatureServer/0
- Formats: JSON, geoJSON, PBF
- MaxRecordCount: 30000
- Capabilities: Query (and Sync/Extract on service)
- Key fields: `ADDR_NUM`, `PRE_DIR`, `STR_NAME`, `STR_TYPE`, `SUF_DIR`, `CITY`, `ZIP`, `STATE`, `COUNTY`, `STRUC_TYPE`, `CAPTURE_METHOD`, geometry Point
- SR: StatePlane Ohio North (WKID 3734/102722); query with `outSR=4326`

**Example query pattern (no owner names):**
```
.../0/query?where=ADDR_NUM='936' AND STR_NAME='SPRINGDALE' AND STR_TYPE='ST' AND CITY='Akron'
&outFields=ADDR_NUM,STR_NAME,STR_TYPE,CITY,ZIP,OBJECTID
&returnGeometry=true&outSR=4326&f=json
```

### B) Alternate Address_Points FeatureServer
- https://scgis.summitoh.net/hosted/rest/services/Address_Points/FeatureServer

### C) Open Data / ArcGIS Online org address points (OA source)
- https://services3.arcgis.com/3Ukh5HzAdI6WZ3KP/arcgis/rest/services/Address_Points/FeatureServer/0
- Listed in OA `sources/us/oh/summit.json`

### D) Tax Parcels (public)
- https://services3.arcgis.com/3Ukh5HzAdI6WZ3KP/arcgis/rest/services/TaxParcels_public/FeatureServer/0
- Fields include `SITEADDRESS`, `PARCELID`, geometry Polygon, `returnCentroid=true`
- **Also contains `OWNERNME1`/`OWNERNME2` — DO NOT request for Terra nav**
- Hosted EAM mirror: https://scgis.summitoh.net/hosted/rest/services/Parcel_Layer_for_EAM/FeatureServer/0
- DSS mirror: https://dsssgis01.summitoh.net/server/rest/services/Summit_County_Parcels_for_EAM/FeatureServer

### E) Building Footprints
- https://scgis.summitoh.net/hosted/rest/services/Building_Footprints/MapServer/0
- Fields: `TYPE` (101=Primary, …), `SHAPE_Area`; **no address attributes**
- Query by spatial intersect / distance around address point

### F) Ohio Statewide LBRS Address Points
- https://maps.ohio.gov/arcgis/rest/services/Hosted/Ohio_Statewide_LBRS_Address_Points/FeatureServer
- Updated 2026-04-15 (~5.6M points)
- County ZIP downloads: https://gis1.oit.ohio.gov/geodatadownloadtable/lbrs.aspx

### G) Open Data portal / viewers (HTML — do not scrape)
- Portal: https://data-summitgis.opendata.arcgis.com/ (`licenseInfo`: CC-BY-SA on site item)
- GIS Viewer: https://summitmaps.summitoh.net/GISViewer/
- Disclaimer: data informational; no accuracy guarantee; users accept risk

### H) Akron city GIS
- Portal: https://agis.akronohio.gov/portal
- Hosted folder: https://agis.akronohio.gov/hosting/rest/services/Hosted
- City layers observed are project-specific; **prefer Summit county address points for Springdale St**

## 3.2 License / terms (VERIFIED FACT + caveats)

| Source | Terms observed |
|---|---|
| Summit Open Data site | Site `licenseInfo`: **CC-BY-SA**; strong as-is disclaimer (informational only, no professional advice, users accept risk) |
| Summit FeatureServers | Public Query endpoints; copyrightText empty on address layer |
| Ohio LBRS | Public government GIS; confirm OGRIP/LBRS reuse terms before redistribution |
| OpenAddresses Summit JSON | Points to county services; **source license not relicensed by OA** |
| Overture | Per-source licenses in addresses theme |

**RECOMMENDATION:** For Terra display/navigation cache of coordinates from Summit address points: attribute County of Summit GIS; do not redistribute owner PII; re-check CC-BY-SA share-alike if packaging derivative datasets.

## 3.3 Live Springdale tests (coordinates only — VERIFIED FACT)

### Address-point query works
Query: `STR_NAME='SPRINGDALE' AND STR_TYPE='ST' AND CITY='Akron'` returned dense house numbers including:

| ADDR_NUM | Lon | Lat | ZIP |
|---|---|---|---|
| **936** | **-81.52187967** | **41.11087267** | 44310 |
| 932 | -81.52205181 | 41.11087951 | 44310 |
| 934 | -81.52196753 | 41.11089835 | 44310 |
| 938 | -81.52178073 | 41.11086369 | 44310 |

Also present in county data (collision defense needed):
- `SPRINGDALE` + `DR` in Tallmadge (ZIP 44278)
- `SPRINGDALE` + `RD` in Green (ZIP 44685)

**INFERENCE:** Nominatim/Photon street-only failure is **not** due to missing county data — Summit has the exact point. Terra failed to consult the address-point layer.

### Building footprint near 936 (VERIFIED FACT)
Spatial query within 15 m of address point returned Primary building OBJECTID 102304, area ~2637 sq ft (StatePlane units on layer), rings enclosing the address-point neighborhood.

### Parcel text match for "936 SPRINGDALE ST" (VERIFIED FACT)
`SITEADDRESS LIKE '%936 SPRINGDALE ST%'` on TaxParcels_public returned **empty**. Nearby Springdale ST parcels exist (e.g. 672, 680, 703…).  
**INFERENCE:** Parcel siteaddress coverage is incomplete or formatted differently for some houses; **address points are the reliable first enrichment**. Spatial parcel intersect at the point returned large multipolygon/mineral-rights-like records — treat parcel spatial hits carefully; prefer SITEADDRESS equality when present.

## 3.4 Summit case conclusion

| Question | Answer |
|---|---|
| Public machine-readable endpoint? | **YES** — ArcGIS FeatureServer/MapServer + GeoJSON |
| House number + street? | **YES** on Address_Points |
| Parcel geometry? | **YES** TaxParcels_public / Parcel_Layer_for_EAM |
| Building footprint? | **YES** Building_Footprints MapServer |
| Can resolve 936 Springdale St Akron? | **YES** via address points → ~(-81.52188, 41.11087) |
| Need owner names? | **NO** — omit OWNERNME* |

**RECOMMENDATION for Terra US path:**  
`Global geocoder → if US → county/LBRS/OA address point (STR_TYPE required) → optional building containment → optional parcel bounds → precision-aware camera.`

---

# WAVES 4–17 — OUTLINE STUBS (PA2)

## WAVE 4 — Worldwide architecture
- Country-aware parser → global geocoder → confidence → regional enrichment registry (US counties, EU national registers, CA municipal) → honest fallback.
- Do not hardcode Summit; use pluggable `PrecisionProvider` per ISO country / admin region.

## WAVE 5 — Match quality model
- Proposed hierarchy: ROOFTOP > BUILDING > PARCEL > ADDRESS_POINT > INTERPOLATED > STREET > PLACE > AMBIGUOUS > COORDINATE.
- Evidence gates per class; never promote STREET→ROOFTOP.

## WAVE 6 — Multi-provider consensus
- Score: housenumber equality, street+type equality, ZIP, city, state, coordinate delta, parcel containment, building containment, provider accuracy enum.
- Do **not** average coordinates of disagreeing providers.

## WAVE 7 — Street name collision defense
- Preserve ST/DR/RD/LN/AVE; preserve N/S/E/W; preserve unit.
- Fuzzy match only on street **base name**, never on suffix.
- Case study: Springdale ST vs DR vs RD in Summit County.

## WAVE 8 — Address candidate picker UX
- Show multiple candidates with precision badges when ambiguous.
- Never silent-pick Drive over Street.

## WAVE 9 — Camera framing (Cesium)
- Map match quality → flyTo / BoundingSphere / Rectangle presets.
- STREET must not use property close-up altitude.

## WAVE 10 — Property-aware zoom
- Prefer building footprint or parcel polygon bbox → `Camera.flyToBoundingSphere` / rectangle with padding.

## WAVE 11 — Terrain / 3D correction
- `sampleTerrainMostDetailed` before final camera settle; avoid underground targets.

## WAVE 12 — Two-stage flight
- Stage1 approximate fly + “PREPARING EXACT LOCATION…” → Stage2 refine when address point arrives.
- Or wait if enrichment < N ms budget.

## WAVE 13 — Cache / performance
- Cache normalized address → precision result per provider ToS (Mapbox temporary forbidden; Nominatim requires cache; county points OK with attribution).

## WAVE 14 — Privacy
- Navigation needs coordinates + site address only.
- Never surface owner/taxpayer names from parcel layers unless separately authorized product mode.

## WAVE 15 — Offline / sovereign
- Pelias + OpenAddresses + OSM + WOF; or Nominatim+TIGER; Overture GeoParquet; PostGIS address index; Photon autocomplete.
- Path to WR-GEOCODER.

## WAVE 16 — Failure states
- EXACT/ROOFTOP, BUILDING, PARCEL, ADDRESS_POINT, INTERPOLATED, STREET APPROXIMATE, AMBIGUOUS, NO MATCH, PROVIDER UNAVAILABLE, PRECISION ENRICHMENT UNAVAILABLE.

## WAVE 17 — Test matrix
- Detached house (936 Springdale St Akron), apartment, business, campus, rural, new construction, missing housenumber, duplicate names, ST vs DR, multi-state same address, non-US, parcel w/o building, building w/o addr tag, interpolated-only.

---

# TOP FINDINGS (executive)

1. **Root cause:** OSM/Nominatim/Photon lack housenumber points on many US streets → STREET/INTERPOLATED; not a camera-only bug.
2. **Summit County publishes exact address points** via public ArcGIS FeatureServer — 936 Springdale St Akron is present.
3. **Verified coordinate** for 936 Springdale St Akron OH 44310: **lon -81.52187967, lat 41.11087267** (WGS84).
4. **Street collision is real in-county:** SPRINGDALE ST (Akron), DR (Tallmadge), RD (Green) — suffix must be first-class.
5. **US refinement chain is viable:** GEOCODER → ADDRESS POINT → PARCEL → BUILDING.
6. **Census Geocoder is never rooftop** — always interpolated; do not use for property close-up claims.
7. **Pelias `match_type` + Mapbox `accuracy` + Smarty `precision` + HERE `houseNumberType`** are the best commercial/open truth labels.
8. **OpenAddresses already indexes Summit** (`sources/us/oh/summit.json`) including buildings + parcels endpoints.
9. **Overture addresses (~472M)** are useful bulk data but points are not guaranteed rooftop; theme is Alpha.
10. **Building footprints** exist at Summit MapServer; useful for containment/framing; no address field on footprint layer.
11. **Parcel SITEADDRESS** is useful but incomplete for some house numbers; address points are more reliable for this case.
12. **Privacy:** Parcel layers expose owner names — Terra queries must omit `OWNERNME*`; navigation does not need them.

---

# PRIMARY RESEARCH Q&A (partial — Waves 1–3)

1. **Why street-only?** Missing OSM housenumbers + TIGER interpolation + Photon ranking.
2. **Strongest lawful US path?** County/LBRS/OA address points → optional parcel/building; commercial rooftop (Smarty/Mapbox/HERE/Esri) as paid upgrade.
3. **OA/Overture value?** High for US enrichment; Summit already covered in OA.
4. **County API value?** **Decisive** for Akron case — exact point available publicly.
5. **Commercial rooftop?** Smarty Rooftop, Mapbox `rooftop`, Esri PointAddress+rooftop, HERE PA (with caveats), TomTom PAD.
6–12. Deferred to PA2 Waves 5–15.

---

# ARTIFACTS / URL INDEX

| Resource | URL |
|---|---|
| Summit Address Points FS | https://scgis.summitoh.net/hosted/rest/services/Address/Address_Points/FeatureServer |
| Summit TaxParcels public | https://services3.arcgis.com/3Ukh5HzAdI6WZ3KP/arcgis/rest/services/TaxParcels_public/FeatureServer/0 |
| Summit Building Footprints | https://scgis.summitoh.net/hosted/rest/services/Building_Footprints/MapServer/0 |
| Summit Open Data | https://data-summitgis.opendata.arcgis.com/ |
| Ohio LBRS statewide | https://maps.ohio.gov/arcgis/rest/services/Hosted/Ohio_Statewide_LBRS_Address_Points/FeatureServer |
| Ohio LBRS downloads | https://gis1.oit.ohio.gov/geodatadownloadtable/lbrs.aspx |
| OA Summit source | https://raw.githubusercontent.com/openaddresses/openaddresses/master/sources/us/oh/summit.json |
| OA batch data | https://batch.openaddresses.io/data |
| Overture addresses guide | https://docs.overturemaps.org/guides/addresses/ |
| Nominatim policy | https://operations.osmfoundation.org/policies/nominatim/ |
| Pelias result quality | https://github.com/pelias/documentation/blob/master/result_quality.md |
| Mapbox Geocoding v6 | https://docs.mapbox.com/api/search/geocoding/ |
| HERE address result types | https://docs.here.com/geocoding-and-search/docs/result-types-address |
| Smarty US Street | https://www.smarty.com/docs/apis/us-street-api/reference |
| Census Geocoder | https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html |

STOP. RESEARCH ONLY. No repository code modified.
