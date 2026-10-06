# TERRA EXACT ADDRESS — WAVES 4–17 RESEARCH
# Commander: Mark | Mode: RESEARCH ONLY | Date: 2026-09-19 (America/New_York)
# Paste target: TERRA_EXACT_ADDRESS_RESEARCH_REPORT (PA2)
# Depends on prior GOLD (W1–3): Nominatim/Photon often STREET for Akron Springdale;
# Summit Address_Points FeatureServer hit 936 Springdale @ ~-81.52188, 41.11087 (~750 m from Nominatim street);
# Chain GEOCODER → ADDRESS POINT → PARCEL → BUILDING; strip owner names;
# Never STREET→ROOFTOP; Street≠Drive; no lat/lon average; Google geocode refuse on Cesium;
# Nominatim must-cache; Mapbox permanent; Summit Open Data CC-BY-SA verify.

Legend: **VERIFIED FACT** | **VENDOR CLAIM** | **INFERENCE** | **RECOMMENDATION**

---

## W4 — WORLDWIDE ARCHITECTURE (country-aware enrichment)

### Pipeline (RECOMMENDATION)

```
TYPED QUERY
  → COUNTRY-AWARE ADDRESS PARSER (libpostal / country rules)
  → GLOBAL GEOCODER(S)  → candidate set + provisional match class
  → ADDRESS CONFIDENCE GATES (house#, street type, admin, ZIP)
  → REGIONAL PRECISION ENRICHMENT (country/region registry)
       US: county address points / parcels / buildings
       EU: national open registries (where lawful)
       CA: ODA / provincial / municipal
       else: OA / Overture / OSM only
  → OPTIONAL: PARCEL containment → BUILDING footprint snap
  → FINAL TARGET + MATCH_QUALITY (never promote beyond evidence)
  → CANDIDATE PICKER if ambiguous / multi-survivor
  → PRECISION-AWARE CESIUM FLIGHT
```

### Country profiles (INFERENCE from public registries + W1–3)

| Region | Enrichment when available | Honest fallback |
|---|---|---|
| **United States** | OA / Overture address points → county FeatureServer address points → tax parcels → building footprints (Microsoft/OSM/Overture) | INTERPOLATED (TIGER/Census) or STREET |
| **Europe** | National open address DBs where licensed (e.g. NL BAG, FR BAN, DK DAR, BE BeSt; UK AddressBase has RPC tiers but licence friction) | STREET / PLACE |
| **Canada** | Open Database of Addresses (ODA) + municipal; NAR is often **blockface** — not rooftop | INTERPOLATED / STREET |
| **Other** | OpenAddresses per-source + OSM `addr:*` + Pelias/CSV custom | STREET / PLACE |

### Hard product rules (RECOMMENDATION)

1. Architecture is **plugin-by-country**, not Summit-hardcoded. Summit is a US enrichment adapter.
2. If enrichment unavailable → keep geocoder class; do **not** invent ROOFTOP.
3. Parser must retain **street type**, **directional**, **unit**, **postcode** as first-class fields.
4. Legal gate per source before cache/display (see W13 / prior GOLD).

### Why STREET-approx is common worldwide (INFERENCE + VERIFIED FACT)

- **VERIFIED FACT:** Pelias returns `match_type=interpolated` when housenumber estimated on road geometry; `accuracy=point` ≠ rooftop ([Pelias result_quality](https://github.com/pelias/documentation/blob/master/result_quality.md)).
- **VERIFIED FACT:** OSM/Nominatim often lack `addr:housenumber` nodes; road `highway` results are street-level.
- **INFERENCE:** Open stacks optimize for *navigable residual* (a place on the network), not property inspection.

---

## W5 — MATCH QUALITY HIERARCHY + EVIDENCE RULES

### Ordered classes (highest → lowest) — RECOMMENDATION

`ROOFTOP > BUILDING > PARCEL > ADDRESS_POINT > INTERPOLATED > STREET > PLACE > AMBIGUOUS > COORDINATE`

Precision is a **ceiling**: evidence can only *lower* a vendor claim, never raise STREET→ROOFTOP.

| Class | Evidence required (all that apply) | Must NOT claim if… |
|---|---|---|
| **ROOFTOP** | (a) Provider **explicitly** labels rooftop/building-entrance precision **AND** house#+street-type+admin match; **OR** (b) coordinate verified **inside** matching building footprint with exact house#+street-type match | Vendor says “point”/“rooftop” but no footprint/entrance corroboration and OA accuracy≠1 |
| **BUILDING** | Building footprint matched to address (OSM `addr:*` on building, or parcel→single primary building) with house# match; centroid or footprint center used | Multiple buildings on parcel without unit disambiguation |
| **PARCEL** | Parcel polygon matched by situs address (or APN linked to situs) with house#+street-type; use parcel centroid or preferred site point | Parcel match but street type conflicts |
| **ADDRESS_POINT** | Authoritative address point (county GIS / OA / E911 public) with exact house#+normalized street **including type**; geometry may be driveway/parcel/unknown | Point exists but street type or ZIP hard-fails |
| **INTERPOLATED** | Provider `match_type=interpolated` / Census range / TIGER osmline; number placed on centerline | Any exact address-point hit for same normalized key |
| **STREET** | Provider resolved highway/street only; housenumber absent or ignored | Housenumber present in query and UI implies property known |
| **PLACE** | City/neighbourhood/POI fallback (`match_type=fallback`, layer≠address) | Treating as address success |
| **AMBIGUOUS** | ≥2 survivors after hard filters, or ST vs DR collision, or cross-ZIP ties | Silent auto-pick |
| **COORDINATE** | User pasted lon/lat; no address proof | Labeling as address match |

### Mapping external vocab → Terra class (VERIFIED FACT + RECOMMENDATION)

| Source signal | Map to | Note |
|---|---|---|
| Pelias `match_type=exact` + `layer=address` + `accuracy=point` | ≤ **ADDRESS_POINT** | **VERIFIED FACT:** Pelias `accuracy` is only `point`\|`centroid`, not rooftop |
| Pelias `match_type=interpolated` | **INTERPOLATED** | VERIFIED FACT |
| Pelias `match_type=fallback` | **PLACE** / **STREET** by layer | VERIFIED FACT |
| OA source `accuracy=1` Rooftop | candidate for ROOFTOP only after Terra rules | **VERIFIED FACT:** OA accuracy IDs 1–5 ([OA CONTRIBUTING](https://github.com/openaddresses/openaddresses/blob/master/CONTRIBUTING.md)) |
| OA `2` On Parcel | **PARCEL** or **ADDRESS_POINT** | VERIFIED FACT |
| OA `3` Driveway | **ADDRESS_POINT** (not ROOFTOP) | VERIFIED FACT |
| OA `4` Interpolation | **INTERPOLATED** | VERIFIED FACT |
| Mapbox `accuracy=rooftop` | provisional; require (b) for Terra ROOFTOP | VENDOR CLAIM until footprint check |
| Google `location_type=ROOFTOP` | **Do not use on Cesium display path** (prior GOLD) | Product rule |
| Nominatim `class=highway` | **STREET** | VERIFIED FACT (semantics) |
| Summit Address_Points hit | **ADDRESS_POINT** (promote to BUILDING/PARCEL only after footprint/parcel join) | VERIFIED FACT (W3 GOLD) |

**OpenAddresses accuracy table (VERIFIED FACT):** 0 User Corrected · 1 Rooftop · 2 On Parcel · 3 Driveway · 4 Interpolation · 5 Unknown.

---

## W6 — MULTI-PROVIDER SCORING (NO AVERAGE)

### Algorithm (RECOMMENDATION)

1. **Collect** candidates from N providers (geocode + enrichment).
2. **Hard filters (eliminate):** house number inequality; street **type** inequality (ST≠DR); state/region inequality; ZIP inequality when both present and authoritative.
3. **Soft rank (score, do not average coords):**
   - Exact normalized street name (type already hard-gated)
   - City/locality equality
   - Provider declared precision tier (mapped to Terra class)
   - Spatial agreement: pairwise distance bands (e.g. <15 m / <50 m / <150 m) as **rank bonus only**
   - Parcel containment of point (+bonus)
   - Building containment of point (+bonus)
4. **Select ONE primary geometry** from the highest-scoring survivor that also has the **highest evidence class**.
5. **Never** average lat/lon across providers (**product rule / prior GOLD**).
6. If top two disagree beyond τ metres at same class → **AMBIGUOUS** + picker.

### Suggested τ (RECOMMENDATION — not measured)

| Context | τ |
|---|---|
| Urban residential same-class agreement | 25–40 m |
| Suburban / large lots | 60–100 m |
| Rural | 150–250 m |
| STREET vs ADDRESS_POINT expected offset | up to ~750 m seen (Springdale GOLD) — treat as enrichment win, not average |

### Consensus example (INFERENCE from GOLD)

- Nominatim: Springdale **Street** geometry (STREET)
- Summit Address_Points: 936 Springdale exact AP (~-81.52188, 41.11087)
- Optional parcel contains AP; optional building inside parcel  
→ **Select AP (or building center if containment proven)** · class ADDRESS_POINT→BUILDING · **discard** street coord · **do not blend**.

---

## W7 — STREET SUFFIX COLLISION DEFENSE

### Preserve as required identity fields (RECOMMENDATION)

| Field | Rule |
|---|---|
| Street **type** | ST / STREET ≠ DR / DRIVE ≠ RD ≠ LN ≠ AVE ≠ CT ≠ BLVD — **never** fuzzy-equal |
| Directionals | N/S/E/W/NE… required when present in query or authoritative record |
| House number | Exact string/int equality after unit split |
| Unit / apt | Separate field; do not merge into house# |
| ZIP / postcode | Hard filter when both sides have one |

### Normalization (RECOMMENDATION)

1. Expand/canonicalize type via USPS Pub 28 (or country equivalent) **into a typed enum**, not free text.
2. Fuzzy (Jaro–Winkler / edit distance) **only on street name stem** and **only after** type + ZIP (if present) agree.
3. Suggested fuzzy gate: JW ≥ 0.92 **and** edit distance ≤ 1 on stem — **RECOMMENDATION**.
4. Photon/Nominatim ranking that prefers “Springdale Drive” over “Springdale Street” must be **defeated by type hard-filter** (prior Terra context + W1).

### Collision UX trigger (RECOMMENDATION)

If query type is ST and a DR candidate scores high on name alone → force **AMBIGUOUS** picker; never auto-fly to DR.

---

## W8 — CANDIDATE PICKER UX

### When to show (RECOMMENDATION)

Show picker if any:
- ≥2 survivors after hard filters
- Street-type collision (ST vs DR)
- Same house#+name in multiple ZIPs/cities/states
- Top class ≤ INTERPOLATED while Commander requested property targeting
- Provider disagreement > τ at same class

### Row content (RECOMMENDATION)

```
WE FOUND MULTIPLE MATCHES
1. 936 Springdale St · Akron, OH 44310 · ADDRESS POINT · [pin solid]
2. Springdale Street · Akron, OH · STREET — APPROXIMATE · [pin hollow]
3. 936 Springdale Dr · Akron, OH · ADDRESS POINT · [warn: different street type]
```

- Primary line: normalized address  
- Secondary: city, region, postcode  
- Badge: Terra match class (never “Exact” unless class ≥ ADDRESS_POINT)  
- Distance hint between candidates when both have coords  
- No owner/resident names (**privacy / W14**)

### Interaction (RECOMMENDATION)

- User must select before close property zoom when AMBIGUOUS.
- Selecting STREET keeps street-context framing (W9).
- “Use approximate and continue” explicit secondary action — never silent.

---

## W9–W11 — CESIUM FLYTO / RECTANGLE / BOUNDINGSPHERE / HPR / TERRAIN

### API facts (VERIFIED FACT — Cesium docs)

1. **`Camera.flyTo({ destination })`**
   - `destination`: `Cartesian3` **or** `Rectangle`
   - `Rectangle` = top-down view of that geographic extent (no range/offset parameter on Rectangle path)
   - Optional `orientation`: heading/pitch/roll **or** direction/up  
   Source: [Camera.flyTo](https://cesium.com/learn/cesiumjs/ref-doc/Camera.html)

2. **`Camera.flyToBoundingSphere(sphere, { offset: HeadingPitchRange })`**
   - Offset is local **east-north-up** at sphere center
   - Camera docs: heading from local y toward x; **positive pitch = below plane; negative = above**; `range` = metres from center; `range=0` auto-fits whole sphere  
   Source: same Camera page `flyToBoundingSphere`

3. **`HeadingPitchRange` class**
   - Stores heading, pitch (radians), range (metres)  
   - **Doc conflict (VERIFIED FACT):** `HeadingPitchRange` page states positive pitch is **above** the plane, while `flyToBoundingSphere` states positive pitch is **below**. Terra implementers should follow **`flyToBoundingSphere` semantics** and visually verify; Cesium `Camera.DEFAULT_OFFSET` is commonly near `(0, -π/4, 0)` (looking down).  
   Sources: [HeadingPitchRange](https://cesium.com/learn/cesiumjs/ref-doc/HeadingPitchRange.html), Camera docs

4. **`sampleTerrainMostDetailed(terrainProvider, positions)`**
   - Updates `Cartographic.height` (metres above ellipsoid) at max available terrain level
   - Promise rejects if provider `availability` undefined  
   Source: [sampleTerrainMostDetailed (1.67)](https://cesium.com/downloads/cesiumjs/releases/1.67/Build/Documentation/sampleTerrainMostDetailed.html)

5. **Terrain + Rectangle hazard (VERIFIED FACT)**
   - `flyTo({ destination: Rectangle })` does not account for terrain height; small rectangles in high terrain can place camera **under** terrain ([CesiumGS#9106](https://github.com/CesiumGS/cesium/issues/9106)).

### Framing method by geometry (RECOMMENDATION)

| Target geometry | Preferred Cesium path |
|---|---|
| Building / parcel polygon | Positions → `BoundingSphere.fromPoints` → `flyToBoundingSphere` + HPR |
| Address point / rooftop point | Terrain-sampled Cartesian3 center + small sphere radius **or** flyTo Cartesian3 with altitude band |
| Street corridor / admin area | `Rectangle.fromDegrees` **or** buffered corridor → prefer Cartesian3 via `getRectangleCameraCoordinates` + terrain raise, not raw Rectangle under terrain |
| City / state / country | Admin `Rectangle` / large sphere |

### Altitude / range bands by match class — **RECOMMENDATION (NOT MEASURED)**

> These are **starting bands for visual QA**, not surveyed optima. Mark every use as RECOMMENDATION until Commander eye-checks on Terra globe.

| Match class | Framing intent | Suggested range / eye height above target* | Pitch (flyToBoundingSphere ENU)* |
|---|---|---|---|
| **ROOFTOP / BUILDING** | Property fills useful viewport | Sphere radius ≈ 0.6–1.2× footprint diagonal; **range ~80–250 m** typical SFH; scale with footprint | ~−25° to −45° |
| **PARCEL** | Entire lot + margin | Sphere/rectangle of parcel + **10–25% pad**; range often **150–500 m** suburban | ~−35° to −55° (or top-down for skinny lots) |
| **ADDRESS_POINT** | Close inspection, no fake rooftop claim | **120–350 m** eye height / range; badge ADDRESS POINT | ~−30° to −45° |
| **INTERPOLATED** | Near street, Approximate badge | **400–900 m**; never SFH rooftop band | ~−40° to −60° |
| **STREET** | Corridor context, not property close-up | **800–2000 m** along segment bbox | ~−45° to −70° or top-down Rectangle |
| **PLACE (city)** | City bounds | Admin rectangle / **3–15 km** | top-down |
| **STATE / COUNTRY** | Admin bounds | Large rectangle | top-down |

\*Heights are camera distance/range above **terrain-sampled** target, not ellipsoid-only.

### Terrain correction timing (RECOMMENDATION)

1. **Before precision flight:** `sampleTerrainMostDetailed` on target + footprint corners; build sphere from terrain-adjusted Cartesians.
2. **Do not** rely on `Globe.getHeight` until tiles are loaded.
3. **After tile load (optional stage-2 micro-adjust):** if height delta > threshold, `flyTo`/`setView` refine — cancel if user grabbed camera.
4. Heights are **ellipsoid-relative** in Cesium Cartographic — do not treat as MSL without geoid model (**VERIFIED FACT** of Cesium Cartographic definition).

### Property-aware zoom (W10) — RECOMMENDATION

- **Best default:** footprint/parcel positions → `BoundingSphere.fromPoints` → `flyToBoundingSphere`.
- Fixed altitude-for-all-addresses is inferior when footprints exist.
- Padding 10–25% — visual test.
- Avoid raw `flyTo(Rectangle)` for small parcels under terrain; raise via terrain sample or use bounding sphere.

---

## W12 — TWO-STAGE FLIGHT VS WAIT-FOR-PRECISION

### Options

| Mode | Behavior | Pros | Cons |
|---|---|---|---|
| **A — Wait** | Block fly until enrichment returns | One honest final view | Feels laggy if county GIS slow |
| **B — Two-stage** | Stage1 fly to best *current* class → Stage2 refine if class improves | Fast perceived nav | Risk of zoom-in then pull-back if over-promised |
| **C — Hold + prepare** | Camera idle/soft pan; UI “PREPARING EXACT LOCATION…”; single fly when ready | Cleanest cinematic | Needs good progress UI |

### Recommendation (RECOMMENDATION)

**Default B with honesty constraints:**

1. Stage1 destination class = **proven** class only (if only STREET, fly STREET framing — never speculative ROOFTOP).
2. Show badge + “Refining exact location…” when enrichment in flight.
3. Stage2 runs only if class **improves** (e.g. STREET→ADDRESS_POINT) or geometry moves > τ.
4. `camera.cancelFlight()` before Stage2; **do not steal** camera if `moveStart` after user interrupt.
5. Prefer **C** when enrichment p95 latency is low (<~800 ms) or when AMBIGUOUS.

**Avoid:** speculative rooftop zoom then humiliating pull-back to street.

---

## W13 — CACHE / PERFORMANCE (brief; needed for Cursor)

| Layer | Cache key | Allowed? |
|---|---|---|
| L1 Geocode | normalized address → provider payload + Terra class | **Nominatim: MUST cache** (VERIFIED FACT — [OSMF Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)); ≤1 req/s public; prefer self-host for product |
| L1 Geocode Mapbox | same | Store only with **`permanent=true`** (VERIFIED FACT — Mapbox Geocoding API) |
| L2 Enrichment | address key → county AP / OA point | Per source licence (Summit CC-BY-SA verify — prior GOLD) |
| L3 Geometry | parcel/building id → ring coords | Local GIS / OSM ODbL attribution |

Google geocode: **refuse on Cesium path** (prior GOLD); if ever used elsewhere, coords retention ≤ vendor ToS.

---

## W14 — PRIVACY (brief)

**RECOMMENDATION:** Display address string + coords + match class only. **Strip owner / taxpayer / resident names** from parcel payloads before UI/logs. Copy: “Property location” not “Resident.” Precise residential geolocation can be sensitive (policy awareness); no identity dump required for navigation.

---

## W15 — SOVEREIGN PATH: Pelias + OA + OSM (+ WOF)

### Stack (VERIFIED FACT)

- **Pelias:** modular open-source geocoder (MIT) on Elasticsearch; importers for **OSM, OpenAddresses, Who’s on First, Geonames, Polylines, CSV** ([pelias/pelias](https://github.com/pelias/pelias/), [data-sources](https://raw.githubusercontent.com/pelias/documentation/master/data-sources.md)).
- **OpenAddresses:** 300M+ authoritative government address points; per-source licences / attribution / share-alike via `state.txt` (**VERIFIED FACT**).
- **OSM:** venues/addresses + polylines roads; **ODbL** attribution + share-alike (**VERIFIED FACT**).
- **WOF:** admin hierarchy for structured fields (**VERIFIED FACT**).
- **Ops:** [pelias/docker](https://github.com/pelias/docker); full-planet: separate import vs query clusters, ES snapshots; large disk/RAM (**VERIFIED FACT** — Pelias full_planet_considerations).

### WR-GEOCODER target (RECOMMENDATION)

```
WR-GEOCODER facade
  ├── Pelias (OA + OSM + WOF [+ optional Overture CSV/Parquet ingest])
  ├── PostGIS overlays: county address points, parcels, buildings (regional)
  ├── Photon optional (autocomplete UX) against same OSM extract
  └── NOT public nominatim.openstreetmap.org for production product traffic
```

### Comparison (INFERENCE)

| Path | Rooftop-capable? | Sovereignty | Notes |
|---|---|---|---|
| Pelias+OA+OSM+WOF | ADDRESS_POINT where OA dense | High | Best open baseline |
| Nominatim+TIGER | Often INTERPOLATED | High | Weak for Terra property zoom |
| Overture addresses | Points; quality varies | High (download) | Good bulk complement, not a search API |
| County GIS overlays | Strongest US exactness | Medium (many licences) | Summit pattern generalizes |
| Hosted Geocode Earth | Same Pelias quality | Low | Fast interim |

**US note (INFERENCE):** OA/Overture/county points beat TIGER for any claim above INTERPOLATED.

---

## W16 — FAILURE / TRUTH STATES

| State | UI must show | Camera |
|---|---|---|
| **EXACT / ROOFTOP** | ROOFTOP (+ source) | Close property (W9) |
| **BUILDING MATCH** | BUILDING | Footprint sphere |
| **PARCEL MATCH** | PARCEL | Parcel frame |
| **ADDRESS POINT** | ADDRESS POINT | Close AP band — not “rooftop” unless rules met |
| **INTERPOLATED** | INTERPOLATED / Approximate | Moderate; badge mandatory |
| **STREET APPROXIMATE** | STREET — APPROXIMATE | Street context only |
| **AMBIGUOUS** | Multiple matches | Picker; no silent fly to property band |
| **NO MATCH** | No match | Stay / soft place fallback with label |
| **PROVIDER UNAVAILABLE** | Provider error | Retry / degrade to next provider; don’t fake class |
| **PRECISION ENRICHMENT UNAVAILABLE** | Geocode class retained + “enhancement unavailable” | Frame for geocode class only |

**Hard rule:** Never silently downgrade a typed housenumber query into street-only while UI chrome implies exact property (**assignment product rule**).

---

## W17 — TEST MATRIX (14 assignment cases)

| # | Case | Pass criteria (RECOMMENDATION) |
|---|---|---|
| 1 | Exact detached house (e.g. **936 Springdale St, Akron, OH**) | ADDRESS_POINT+ via Summit/OA; camera on AP/building; **not** Nominatim street centroid; ST≠DR |
| 2 | Apartment building | Building-level or unit-aware; if unit missing → BUILDING/AMBIGUOUS not fake unit rooftop |
| 3 | Business | Address point or building with name secondary; class honest |
| 4 | Large campus | Parcel/campus polygon framing; avoid SFH altitude |
| 5 | Rural address | Larger τ; INTERPOLATED acceptable if no AP; badge clear |
| 6 | New construction | Miss OA/OSM → INTERPOLATED/STREET or enrichment miss state; no hallucinated rooftop |
| 7 | Missing house# in dataset | STREET/INTERPOLATED; housenumber not implied in UI |
| 8 | Duplicate street name | Disambiguate by city/ZIP/state; else AMBIGUOUS picker |
| 9 | Street vs Drive collision | Hard reject cross-type; picker if both exist |
| 10 | Same address text in multiple states | Require state/region; else AMBIGUOUS |
| 11 | Non-U.S. exact address | Country parser + national registry if configured; else OA/OSM honest class |
| 12 | Parcel without building footprint | Class **PARCEL**; frame parcel; do not claim ROOFTOP |
| 13 | Building footprint without address tag | Cannot claim address match from geometry alone; geocode/AP required |
| 14 | Interpolated-only address | Class **INTERPOLATED**; moderate framing; Approximate badge |

**Add-ons for Cesium QA (RECOMMENDATION):** terrain under/over shoot; two-stage refine; user interrupt; antimeridian rectangle.

---

## TOP_5_RECOMMENDED_IMPLEMENTATION_PATHS

1. **US hybrid truth path (BEST):** Global geocoder (Pelias self-host or Photon/Nominatim self-host) → **county/OA address-point enrichment** → optional parcel → optional building → Terra class → precision framing. Summit adapter first, county registry pattern next.
2. **Pelias+OA worldwide index:** Self-host Pelias with OA+OSM+WOF; map `match_type`/`accuracy` → Terra classes; CSV/PostGIS for priority counties.
3. **Overture Addresses bulk complement:** Periodic GeoParquet ingest into PostGIS/Pelias CSV for coverage fill; still run evidence rules (point ≠ rooftop).
4. **Commercial rooftop assist (non-Google):** Mapbox permanent / HERE / Esri / Smarty as **optional** precision oracles; never average with open results; still footprint-validate before Terra ROOFTOP; **Google refuse on Cesium**.
5. **Interim hosted:** Geocode Earth (Pelias) + on-demand Summit FeatureServer enrichment for OH pilot only — migrate to WR-GEOCODER.

---

## BEST_RECOMMENDED_PATH

**Path 1 — US hybrid truth path**, with Pelias (or equivalent) as global front door and **pluggable regional enrichment** (OA + county FeatureServers + parcel/building). Springdale-class queries: STREET geocode is acceptable Stage0; Summit AP promotes to ADDRESS_POINT; building join may reach BUILDING; ROOFTOP only with explicit evidence.

### WHY

- Matches verified GOLD: open geocoders alone leave Akron Springdale at STREET; Summit AP is ~750 m better and machine-readable.
- Scales worldwide via country plugins without Ohio hardcoding.
- Preserves lawful cache/attribution (Nominatim cache, Mapbox permanent, OA/OSM licences).
- Separates **where** from **how precise** (assignment key product rule).
- Enables sovereign WR-GEOCODER evolution (W15) without blocking interim UX.

### RISKS

| Risk | Mitigation |
|---|---|
| County licence patchwork / CC-BY-SA share-alike | Per-adapter legal review; attribution UI; no redistribution beyond terms |
| OA freshness lag / new construction misses | INTERPOLATED/STREET honesty; optional commercial oracle |
| Vendor “rooftop” overclaim | Terra evidence gates; footprint check |
| Cesium under-terrain on Rectangle | Prefer BoundingSphere + `sampleTerrainMostDetailed` |
| Two-stage zoom thrash | Only refine on class improvement; respect user interrupt |
| ST/DR silent wrong pick | Type hard-filter + picker |
| PII from parcel layers | Strip owner names always |
| Public Nominatim ban/block | Must-cache + rate limit; self-host for product |
| Averaging temptation under multi-provider disagreement | Select-one policy + AMBIGUOUS |

---

## CURSOR_IMPLEMENTATION_REQUIREMENTS

When coding begins (out of scope for this research), Cursor must:

1. Implement Terra **match class enum** + evidence gates; **forbid STREET→ROOFTOP** promotion.
2. Parse & persist street **type**, directional, unit, ZIP as separate fields; ST≠DR hard filter.
3. Pipeline: geocode → enrichment adapters (interface) → parcel/building optional → final target.
4. Summit/US adapter: FeatureServer address-point query by house#+street; strip owner fields.
5. Multi-provider **select-one** scorer; **no coordinate averaging**.
6. Candidate picker UI for AMBIGUOUS / type collision / multi-state.
7. Cesium: terrain-sample then `flyToBoundingSphere` (preferred) or safe Cartesian3; avoid raw small Rectangle under terrain; class-based range bands; badges bound to class.
8. Two-stage flight with cancel + user-interrupt guard; Stage1 framing ≤ proven class.
9. Cache layer respecting Nominatim must-cache & Mapbox `permanent=true`; no Google-on-Cesium.
10. Privacy: never render owner/taxpayer names from GIS.
11. Telemetry: store class, source, enrichment hit/miss — not resident identity.
12. Tests: all **14 W17 cases** + Springdale GOLD regression (AP coords vs street offset).
13. Feature-flag enrichment per country/county; default honest fallback.
14. Docs: label camera bands as tuned RECOMMENDATIONs until visual QA sign-off.

---

## OPEN_QUESTIONS

- Terra ROOFTOP = building centroid vs entrance vs intersects-footprint?
- Exact τ metres per density class after visual QA?
- Always-confirm picker vs auto-accept single ADDRESS_POINT?
- AddressBase / FR BAN / NAR licence fit for War Room commercial use?
- Multi-unit tower unit resolution data source?
- PO Box / highway contract box policy?
- Enrichment outage SLA and badge copy?
- Confirm Summit Open Data licence text CC-BY-SA vs layer-specific terms (verify before ship).

---

## QUICK REFERENCE — GOLD TIE-IN

| Item | Value | Class |
|---|---|---|
| Nominatim/Photon Springdale | Often STREET only | VERIFIED FACT (W1–3) |
| Summit AP 936 Springdale | ~lon **-81.52188**, lat **41.11087** | VERIFIED FACT (W3) |
| Offset vs street geocode | ~**750 m** | VERIFIED FACT (W3) |
| Chain | GEOCODER → AP → PARCEL → BUILDING | RECOMMENDATION |
| No STREET→ROOFTOP / no avg / ST≠DR / no Google on Cesium | Product rules | GOLD |
| Nominatim cache / Mapbox permanent / Summit licence verify | Legal | VERIFIED FACT / prior GOLD |

END WAVES 4–17

---

# TERRA_EXACT_ADDRESS_RESEARCH_REPORT — EXECUTIVE FOLD (PA2)
# Research only | 2026-09-19 | No code/build

CURRENT_FAILURE_CLASS = STREET_APPROXIMATE_FROM_OSM_GEOCODER (housenumber typed; provider returned highway/street geometry; camera framed on road ~750m from true address point)

WHY_STREET_APPROXIMATE_HAPPENS =
- OSM/Nominatim often lack addr:housenumber nodes → addresstype=road
- Photon may rank wrong street type (Drive > Street)
- Census/TIGER = range INTERPOLATION not rooftop
- Camera altitude alone does not fix wrong coordinate

BEST_GLOBAL_GEOCODER_ARCHITECTURE = country-aware parse → global geocoder(s) → confidence gates → regional enrichment plugin → parcel/building optional → match class → picker if ambiguous → precision-aware Cesium flight

BEST_US_PRECISION_ARCHITECTURE = GEOCODER → ADDRESS_POINT (county/OA) → PARCEL (spatial) → BUILDING footprint → class badge; strip owner fields

OPENADDRESSES = READY dumps for Pelias/custom; per-source licenses; accuracy 0–5 (1=rooftop claim only)
OVERTURE = PARTIAL addresses GeoParquet; point class varies; not all rooftop
PELIAS = READY self-host path; match_type exact|interpolated|fallback; accuracy point|centroid ≠ rooftop
NOMINATIM = PARTIAL; must-cache; often STREET for Akron Springdale
CENSUS = INTERPOLATION only (honesty)
COUNTY_PARCELS = READY where FeatureServer published (Summit proven); strip owners
BUILDING_FOOTPRINTS = PARTIAL (Summit 2000 vintage; MS/Overture fresher)

COMMERCIAL_OPTIONS = HERE/Mapbox/Smarty/TomTom/Esri with storage SKUs; Google REFUSE on Cesium

SUMMIT_COUNTY_AKRON_FINDINGS =
- Address_Points FeatureServer READY; 936 SPRINGDALE ST → ~-81.52188, 41.11087
- Nominatim street ~41.10413 (~750m south) — proves JUMP must prefer local AP
- Building_Footprints MapServer READY (2000); TaxParcels READY (strip OWNERNME*)
- Addr GeocodeServer + Ohio LBRS statewide also public
PUBLIC_MACHINE_READABLE_SOURCE = scgis.summitoh.net Address_Points + TaxParcels + Building_Footprints; Ohio LBRS; Open Data hub CC-BY-SA verify per card
LICENSE = Summit Open Data CC-BY-SA (verify); as-is disclaimer; no owner display

MATCH_QUALITY_MODEL = ROOFTOP > BUILDING > PARCEL > ADDRESS_POINT > INTERPOLATED > STREET > PLACE > AMBIGUOUS > COORDINATE (never promote beyond evidence)

MULTI_PROVIDER_SCORING = hard filter house#/street-type/ZIP; soft rank; SELECT ONE geometry; NEVER average lat/lon

STREET_NAME_COLLISION_DEFENSE = ST≠DR≠RD≠LN hard; structured parse; picker on ambiguity

PARCEL_VALIDATION = spatial join from address point preferred over SITEADDRESS string
BUILDING_VALIDATION = footprint containment; vintage caveat

CAMERA_FRAMING_RECOMMENDATION = flyToBoundingSphere + HeadingPitchRange after terrain sample; class-based range bands (RECOMMENDATION until visual QA)
CESIUM_FRAMING_METHOD = sampleTerrainMostDetailed → BoundingSphere.fromPoints → flyToBoundingSphere; avoid raw small Rectangle under terrain

TWO_STAGE_FLIGHT = Stage1 honest class frame + “Refining…”; Stage2 only if class improves; cancel on user interrupt; prefer wait if enrichment <~800ms

TERRAIN_CORRECTION = sample before precision flight; ellipsoid height awareness

CACHE_MODEL = Nominatim must-cache ≤1rps; Mapbox permanent=true to store; HERE/Esri storage SKUs; self-host Pelias OWNABLE
PRIVACY_MODEL = situs/APN/geometry only; REFUSE owner/taxpayer names in nav

WORLDWIDE_SCALING_MODEL = plugin-by-country enrichment; Summit = US adapter pattern
SOVEREIGN_GEOCODER_PATH = Pelias + OA + OSM + WOF + PostGIS county overlays (WR-GEOCODER)

TOP_5_RECOMMENDED_IMPLEMENTATION_PATHS =
1. US hybrid: geocoder → county/OA AP → parcel → building → class → framing (BEST)
2. Self-host Pelias+OA worldwide
3. Overture Addresses complement
4. Commercial non-Google oracles + footprint validate
5. Interim Geocode Earth + Summit OH pilot → sovereign migrate

BEST_RECOMMENDED_PATH = Path 1 US hybrid truth path
WHY = Fixes Springdale 750m miss; worldwide via plugins; lawful; honest badges; sovereign path clear
RISKS = licence patchwork; OA lag; vendor rooftop overclaim; under-terrain camera; ST/DR mispick; PII; averaging temptation
OPEN_QUESTIONS = ROOFTOP = centroid vs entrance?; τ after QA?; always-confirm picker?; multi-unit; PO Box

CURSOR_IMPLEMENTATION_REQUIREMENTS =
1 Match-class enum + evidence gates
2 Street type/dir/unit/ZIP fields; ST≠DR hard
3 Geocode → enrichment → parcel/building → final
4 Summit Address_Points adapter; strip owners
5 Multi-provider select-one; no average
6 Candidate picker AMBIGUOUS
7 Cesium terrain sample + flyToBoundingSphere; badges=class
8 Two-stage + interrupt guard
9 Nominatim cache; Mapbox permanent; no Google-on-Cesium
10 Privacy strip
11 Telemetry class/source not identity
12 W17 14 tests + Springdale GOLD regression
13 Feature-flag enrichment per country/county
14 Camera bands RECOMMENDATION until visual QA

STOP. RESEARCH ONLY. DO NOT MODIFY REPOSITORY.


## COMMANDER LOCK — ANY PLACE TYPED (2026-09-19)
Applies to every JUMP/GO query worldwide. Summit/Akron is case study only. Plugin-by-country enrichment; honest STREET/INTERPOLATED/PLACE when local precision unavailable. Never fake ROOFTOP.
