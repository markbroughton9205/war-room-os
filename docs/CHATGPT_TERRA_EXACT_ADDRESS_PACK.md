# CHATGPT / CURSOR — TERRA EXACT ADDRESS / PLACE RESOLUTION PACK
# Commander: Mark | 2026-09-19 | LOCK: ANY PLACE TYPED (worldwide)
# RESEARCH ONLY — BUILD HELD

## COMMANDER LOCK (2026-09-19)
This resolution path applies to **any place typed** into Terra JUMP/GO — addresses, cities, landmarks, worldwide — not Summit County / Akron only.

Summit Address Points (936 Springdale) = **case study GOLD**, not the product scope limit.
Architecture = country/region enrichment plugins + honest fallback when precision data absent.

---


# CHATGPT / CURSOR — TERRA EXACT ADDRESS / ROOFTOP RESOLUTION PACK
# Commander: Mark | 2026-09-19 | Research Swarm + PA2
# RESEARCH ONLY — BUILD HELD
# Canonical tree: Nebula live-council-intelligence-repair @ 10a3d34+

## YOUR ROLE
Review this research and produce an implementation-ready delta for Terra JUMP when Commander authorizes.
Do NOT modify product code from this pack alone without authorization.
Do NOT expose owner/resident/taxpayer names.
Do NOT use Google Geocoding as default on Cesium.
Never promote STREET → ROOFTOP.

## ONE-LINE
STREET—APPROXIMATE on Springdale is OSM/Nominatim street geometry (~750 m miss vs Summit Address Points). Fix = hybrid geocoder → county/OA address point → parcel → building → honest match badge → Cesium flyToBoundingSphere with terrain sample.

## BEST PATH
US hybrid: parse → global geocoder candidates → Summit/OA ADDRESS_POINT enrichment → optional parcel/building validation → MATCH class → precision-aware camera. ST≠DR≠RD. Multi-hit picker. No lat/lon average. Strip owners. Worldwide = country enrichment plugins; Ohio is case study not the only path.

## SUMMIT GOLD
FeatureServer: https://scgis.summitoh.net/hosted/rest/services/Address/Address_Points/FeatureServer
936 Springdale St Akron OH 44310 ≈ lon -81.52188, lat 41.11087 (WGS84)

Full report follows.
---
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

# ========== APPENDIX: WAVES 1–3 DEEP ==========
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
