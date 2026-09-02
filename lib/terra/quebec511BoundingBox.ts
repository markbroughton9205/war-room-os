/**
 * Terra Québec 511 layers (cameras + events) -> bounding-box query, mirroring
 * lib/terra/ontarioBoundingBox.ts's convention. The MTMD WFS accepts a real server-side bbox —
 * confirmed live this build with the axis-order discovery documented in
 * lib/research-engine/providers/quebec_511_cameras.ts (WFS 2.0.0 EPSG:4326 order is lat,lon —
 * the same "lamin,lomin,lamax,lomax" order this module emits, so the query string is passed
 * straight through to the upstream `bbox` parameter).
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 12

// Québec + a small margin — the real, documented scope of Québec 511 / the MTMD open-data WFS
// (provincial, not national).
export const QUEBEC_511_COVERAGE_BBOX: TerraDegreeRectangle = { west: -79.9, south: 44.9, east: -56.9, north: 62.7 }

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasQuebec511Coverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, QUEBEC_511_COVERAGE_BBOX)
}

export function buildTerraQuebec511BoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = QUEBEC_511_COVERAGE_BBOX): string | null {
  if (!rectangle) return null
  const { west, south, east, north } = rectangle
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (east <= west || north <= south) return null
  if (east - west > MAX_BBOX_SPAN_DEG || north - south > MAX_BBOX_SPAN_DEG) return null
  if (!rectanglesIntersect(rectangle, coverageBbox)) return null

  const clampedSouth = Math.max(-90, Math.min(90, south))
  const clampedNorth = Math.max(-90, Math.min(90, north))
  const clampedWest = Math.max(-180, Math.min(180, west))
  const clampedEast = Math.max(-180, Math.min(180, east))
  if (clampedEast <= clampedWest || clampedNorth <= clampedSouth) return null

  return `${clampedSouth.toFixed(2)},${clampedWest.toFixed(2)},${clampedNorth.toFixed(2)},${clampedEast.toFixed(2)}`
}
