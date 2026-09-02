/**
 * Terra Ontario 511 layers (cameras + events) -> bounding-box query, mirroring
 * lib/terra/trafficEventBoundingBox.ts's convention. 511on.ca's own /cameras and /event endpoints
 * have no bounding-box parameter — both always return the whole-province dataset — so
 * lib/research-engine/providers/ontario_511_cameras.ts and ontario_511_events.ts filter
 * client-side, same "lamin,lomin,lamax,lomax" shape as the Digitraffic family (not Open511's
 * "west,south,east,north" shape, since these adapters do their own client-side lat/lon comparison
 * rather than forwarding a bbox param upstream).
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 12

// Ontario + a small margin — the real, documented scope of 511on.ca (provincial, not national).
export const ONTARIO_511_COVERAGE_BBOX: TerraDegreeRectangle = { west: -95.3, south: 41.6, east: -74.2, north: 57.0 }

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasOntario511Coverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, ONTARIO_511_COVERAGE_BBOX)
}

export function buildTerraOntario511BoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = ONTARIO_511_COVERAGE_BBOX): string | null {
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
