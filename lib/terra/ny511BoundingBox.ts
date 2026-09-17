/**
 * Terra New York State traffic-camera layer → bounding-box query. 511NY's getcameras endpoint
 * returns the statewide catalog (no bbox param) — the adapter filters client-side. Product UI
 * never uses "511NY" as a product name (DAA); this module is the coverage gate only.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 8

export const NY511_COVERAGE_BBOX: TerraDegreeRectangle = { west: -79.8, south: 40.45, east: -71.75, north: 45.05 }

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasNy511Coverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, NY511_COVERAGE_BBOX)
}

export function buildTerraNy511BoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = NY511_COVERAGE_BBOX): string | null {
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
