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
