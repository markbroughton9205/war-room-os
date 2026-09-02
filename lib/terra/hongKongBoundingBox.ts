/**
 * Terra Hong Kong TD camera layer -> bounding-box query, mirroring
 * lib/terra/ontarioBoundingBox.ts's convention. The data.gov.hk camera-locations CSV has no
 * bounding-box parameter — it always returns the full territory list — so
 * lib/research-engine/providers/hong_kong_td_cameras.ts filters client-side, same
 * "lamin,lomin,lamax,lomax" shape as the Digitraffic/Ontario family.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 4

// Hong Kong SAR + a small margin — the real, documented scope of the Transport Department's
// traffic snapshot camera network (territory-wide, not regional).
export const HONG_KONG_TD_COVERAGE_BBOX: TerraDegreeRectangle = { west: 113.8, south: 22.1, east: 114.5, north: 22.6 }

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasHongKongTdCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, HONG_KONG_TD_COVERAGE_BBOX)
}

export function buildTerraHongKongTdBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = HONG_KONG_TD_COVERAGE_BBOX): string | null {
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
