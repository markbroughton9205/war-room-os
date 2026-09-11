# Terra — Automatic Urban Detail

Status: **PASS / LIVE-VALIDATED / COMMITTED** (`9571af17c2330f5b7edfc67ea3f9e08b73321932`)

This is **not** a numbered Master OS roadmap item. It is a Terra side capability
closed after the #12 maritime/provider defect repair. Do not invent a new roadmap
number for it.

## Commander behavior

Zoom in on `/terra`:

1. City LOD → major OSM roads
2. Local / street LOD → neighborhood streets, residential roads
3. Houses and building footprints appear automatically
4. Extrusion uses SOURCE vs INFERRED height truth
5. Labels use real OSM names when present

**No Buildings button is required.** Urban geography is camera-LOD automatic.

Intelligence (vessels, earthquakes, traffic) remains a **separate overlay** above
base geography.

## Architecture preserved

- Existing Cesium Viewer (`TerraGlobe` / `TerraShell`)
- OSM / Overpass as primary urban data (`/api/terra/urban-tiles`)
- Viewport-bounded fetching + tile/LOD keyed requests
- ~450ms settle debounce
- Browser/server in-flight dedupe; server concurrency 1
- Stale usable cache; Retry-After / bounded backoff
- `/globe` untouched

## Terrain truth

Real DEM terrain is **not** configured in this environment.

- Real terrain provider absent → ellipsoid fallback
- Terrain status: **UNAVAILABLE**
- Record: **REAL TERRAIN REQUIRES CONFIGURED TERRAIN PROVIDER**
- Do not fake terrain. Do not auto-subscribe to Cesium ion.

## Non-blockers (honest remaining limits)

- Public Overpass can rate-limit under load
- Stale-cache + backoff mitigate temporary provider blips (city geometry must not wipe)
- Dense downtowns are capped and may show **DEGRADED**
- Self-hosted OSM / vector tiles remain the long-term sovereign path

## Related closed Terra work

| Concern | Status | Commit |
|---|---|---|
| #12 Live Globe Intel (original) | CLOSED | `fe74bfe` |
| #12 maritime/provider runtime truth (defect repair) | CLOSED | `e9a8372` + hygiene follow-up `8d8b76b` |
| Automatic urban streets/buildings | CLOSED | `9571af1` |

## Validation

- `pnpm run validate:terra-urban-detail`
- Chained from `pnpm run validate:terra` via `lib/terra/urbanDetail/validation.ts`
