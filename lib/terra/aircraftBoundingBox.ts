/**
 * Terra aircraft layer -> OpenSky bounding-box query string. Pure and deterministic: converts the
 * Commander's current visible camera rectangle (degrees) into the exact
 * "lamin,lomin,lamax,lomax" format lib/research-engine/providers/opensky.ts requires, or `null`
 * when no bounded query should be sent at all.
 *
 * Two honesty/cost guards, both load-bearing:
 *   - MAX_BBOX_SPAN_DEG rejects a rectangle wide enough that querying it would mean "most of the
 *     visible hemisphere" — OpenSky's own anonymous quota costs scale with bbox area, so this is
 *     the same "do not attempt to download the entire world continuously" requirement as a hard
 *     numeric ceiling, independent of (and a backstop for) the camera-scale gate TerraShell.tsx
 *     applies before ever calling this function.
 *   - BBOX_GRID_DEG snaps to a coarse grid so small camera nudges converge on the same bbox
 *     string — reusing the Research Engine's own 60s server-side cache
 *     (lib/research-engine/cache/ttlCache.ts CACHE_TTL.liveFeed) instead of missing it on every
 *     pixel of camera drift, conserving OpenSky's real daily credit budget. The south/west edge
 *     always snaps outward-down and the north/east edge always snaps outward-up (never a
 *     symmetric round-to-nearest) specifically so a real, non-degenerate span smaller than one
 *     grid cell (e.g. the Commander zoomed in tight at building scale) can never collapse into a
 *     `lamin === lamax` box that would otherwise still pattern-match OpenSky's bbox validation and
 *     silently return zero real aircraft.
 */
export type TerraDegreeRectangle = { west: number; south: number; east: number; north: number }

const MAX_BBOX_SPAN_DEG = 20
const BBOX_GRID_DEG = 0.1

function snapDown(value: number): number {
  return Math.floor(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function snapUp(value: number): number {
  return Math.ceil(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

export function buildTerraAircraftBoundingBoxQuery(rectangle: TerraDegreeRectangle | null): string | null {
  if (!rectangle) return null
  const { west, south, east, north } = rectangle
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (east <= west || north <= south) return null
  if (east - west > MAX_BBOX_SPAN_DEG || north - south > MAX_BBOX_SPAN_DEG) return null

  const clampedSouth = Math.max(-90, Math.min(90, south))
  const clampedNorth = Math.max(-90, Math.min(90, north))
  const clampedWest = Math.max(-180, Math.min(180, west))
  const clampedEast = Math.max(-180, Math.min(180, east))
  if (clampedEast <= clampedWest || clampedNorth <= clampedSouth) return null

  const lamin = snapDown(clampedSouth).toFixed(1)
  const lomin = snapDown(clampedWest).toFixed(1)
  const lamax = snapUp(clampedNorth).toFixed(1)
  const lomax = snapUp(clampedEast).toFixed(1)
  return `${lamin},${lomin},${lamax},${lomax}`
}
