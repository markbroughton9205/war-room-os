# God's Eye Phase 3 — TerraShell / UI Lane Handoff (Lane A)

Seven new Terra layers are fully wired through the Research Engine → normalizer → layerCatalog
pipeline. The UI lane only needs to register them in TerraShell's layer toggles and (for cameras)
its bbox-gated refresh logic. Nothing here branches on providerId downstream — the generic
`app/api/terra/layers/[layerId]` route already serves all of them.

## New layer IDs (in TERRA_LAYER_CATALOG order)

| layerId | kind | bbox module (coverage gate + query builder) | refreshIntervalMs |
|---|---|---|---|
| `hong_kong_td_cameras` | traffic_camera | `lib/terra/hongKongBoundingBox.ts` — `terraCameraViewHasHongKongTdCoverage` / `buildTerraHongKongTdBoundingBoxQuery` | 60_000 |
| `quebec_511_cameras` | traffic_camera | `lib/terra/quebec511BoundingBox.ts` — `terraCameraViewHasQuebec511Coverage` / `buildTerraQuebec511BoundingBoxQuery` (shared by both Québec layers) | 60_000 |
| `quebec_511_events` | traffic_event | same `quebec511BoundingBox.ts` | 60_000 |
| `jartic_traffic_volumes` | traffic_flow_observation | `lib/terra/jarticBoundingBox.ts` — `terraCameraViewHasJarticCoverage` / `buildTerraJarticBoundingBoxQuery` | 900_000 (15 min — hourly source, ~2h lag) |
| `wzdx_wsdot` | traffic_event | `lib/terra/wzdxBoundingBox.ts` — `terraCameraViewHasWzdxCoverage(rect, providerId)` / `buildTerraWzdxBoundingBoxQuery(rect, providerId)` (per-state envelopes) | 60_000 |
| `wzdx_iowa_dot` | traffic_event | same `wzdxBoundingBox.ts` | 60_000 |
| `wzdx_kytc` | traffic_event | same `wzdxBoundingBox.ts` | 300_000 (5 min — 30-min source cadence) |

## Camera-image notes for the UI lane

- `hong_kong_td_cameras`: `lib/terra/cameraImageProxy.ts` already supports it
  (`provider=hong_kong_td_cameras`, id = camera key like `BC101F` → `tdcctv.data.one.gov.hk/{key}.JPG`).
  TODO for UI lane: add `'hong_kong_td_cameras'` to `ALLOWED_PROVIDERS` in
  `app/api/terra/camera-image/route.ts` (one-line additive change; file owned by another lane's
  Phase 2 work, so Lane A deliberately did not touch it).
- `quebec_511_cameras`: NO direct image exists — the source's per-camera URL is an HTML viewer
  page (`quebec511.info/Carte/Fenetres/FenetreVideo.html?id={n}`). `properties.imageUrl` is
  always `null`; `properties.viewerUrl` carries the page. Render a "view at source" link, never
  an `<img>`.
- Both new camera layers have `properties.freshness === 'unknown'` (sources publish no per-image
  capture timestamp) — do not render them as live/fresh.

## Coverage-gate integration pattern

Mirror what TerraShell already does for `ontarioBoundingBox.ts` / `roadCameraBoundingBox.ts`:
compute the camera-view rectangle, call the module's `terraCameraViewHas*Coverage` to decide
NO_COVERAGE vs fetch, and pass `buildTerra*BoundingBoxQuery(rect)` as the layer's `?q=` override.
All query strings are the `"lamin,lomin,lamax,lomax"` shape; JARTIC's CQL lon,lat reordering and
Québec's WFS lat,lon axis order are already handled inside the adapters — the UI never reorders.

## Geometry notes

- `quebec_511_events` and all three `wzdx_*` layers produce real `path` (LineString) geography —
  the generic Cesium polyline path DriveBC already renders covers them.
- WZDx `MultiPoint` events are rendered at their first point with `properties.geometryType ===
  'MultiPoint'` preserved — never silently collapsed without record.
