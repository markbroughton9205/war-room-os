/**
 * Terra OHGO / ODOT camera layer → bounding-box query. OHGO's cameras list has no server-side
 * bbox filter — the adapter fetches the statewide catalog (ETag-cached) and filters client-side,
 * same lamin,lomin,lamax,lomax shape as Ontario / Digitraffic.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 8

// Ohio + a small margin — the real, documented scope of OHGO / ODOT cameras (not Ohio Turnpike).
export const OHGO_COVERAGE_BBOX: TerraDegreeRectangle = { west: -84.9, south: 38.4, east: -80.5, north: 42.0 }

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasOhgoCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, OHGO_COVERAGE_BBOX)
}

export function buildTerraOhgoBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = OHGO_COVERAGE_BBOX): string | null {
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
