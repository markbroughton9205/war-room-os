/**
 * Terra Caltrans CWWP2 camera layer → bounding-box query + district picker.
 * Status JSON is published per district (d1–d12). The adapter only fetches districts whose
 * coverage envelope intersects the current view — never all 12 on every pan.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 8

export const CALTRANS_COVERAGE_BBOX: TerraDegreeRectangle = { west: -124.5, south: 32.5, east: -114.1, north: 42.1 }

/** Approximate district envelopes used only to decide which status files to fetch. */
export const CALTRANS_DISTRICT_BBOXES: Record<string, TerraDegreeRectangle> = {
  d1: { west: -124.5, south: 38.7, east: -122.4, north: 42.1 },
  d2: { west: -123.8, south: 39.3, east: -119.9, north: 42.1 },
  d3: { west: -122.6, south: 38.0, east: -119.6, north: 40.0 },
  d4: { west: -123.6, south: 36.8, east: -121.2, north: 38.9 },
  d5: { west: -122.4, south: 34.4, east: -119.4, north: 37.2 },
  d6: { west: -121.0, south: 34.8, east: -117.6, north: 37.6 },
  d7: { west: -119.3, south: 33.3, east: -117.6, north: 34.9 },
  d8: { west: -118.0, south: 33.4, east: -114.1, north: 35.8 },
  d9: { west: -119.6, south: 35.2, east: -115.6, north: 38.8 },
  d10: { west: -121.6, south: 36.7, east: -119.0, north: 38.6 },
  d11: { west: -117.6, south: 32.5, east: -114.5, north: 33.6 },
  d12: { west: -118.2, south: 33.3, east: -117.4, north: 33.95 },
}

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasCaltransCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, CALTRANS_COVERAGE_BBOX)
}

export function caltransDistrictsIntersecting(rectangle: TerraDegreeRectangle): string[] {
  return Object.entries(CALTRANS_DISTRICT_BBOXES)
    .filter(([, bbox]) => rectanglesIntersect(rectangle, bbox))
    .map(([id]) => id)
}

export function buildTerraCaltransBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = CALTRANS_COVERAGE_BBOX): string | null {
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
