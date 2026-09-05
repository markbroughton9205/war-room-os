/**
 * Terra Traffic Event layer -> drivebc_events bounding-box query, mirroring
 * lib/terra/maritimeBoundingBox.ts's coverage-envelope-gate convention. Unlike Digitraffic
 * (marine or road cameras), DriveBC's own Open511 endpoint DOES accept a real server-side `bbox`
 * query parameter (confirmed live this build: api.open511.gov.bc.ca/events?bbox=W,S,E,N returns a
 * genuinely filtered result set, not the whole province) — so this returns a plain "W,S,E,N"
 * string for the adapter to pass straight through as the upstream query param, rather than a
 * client-side post-filter.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 15

// British Columbia + a small margin — the real, documented scope of the DriveBC / Open511
// jurisdiction (province-level road events only, not a national feed).
export const DRIVEBC_EVENTS_COVERAGE_BBOX: TerraDegreeRectangle = { west: -139.3, south: 48.2, east: -114.0, north: 60.1 }

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasTrafficEventCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, DRIVEBC_EVENTS_COVERAGE_BBOX)
}

export function buildTerraTrafficEventBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = DRIVEBC_EVENTS_COVERAGE_BBOX): string | null {
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

  return `${clampedWest.toFixed(2)},${clampedSouth.toFixed(2)},${clampedEast.toFixed(2)},${clampedNorth.toFixed(2)}`
}
