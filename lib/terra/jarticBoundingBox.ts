/**
 * Terra JARTIC traffic-volume layer -> bounding-box query, mirroring
 * lib/terra/ontarioBoundingBox.ts's convention. The JARTIC WFS accepts a real server-side
 * CQL BBOX — lon,lat-ordered per CQL convention (confirmed live this build; the adapter does
 * the reordering) — so this module emits the same "lamin,lomin,lamax,lomax" shape as the other
 * bbox modules and the adapter maps it onto the CQL filter.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 8

// Japan's main-island extent (Kyushu/Shikoku/Honshu/Hokkaido) + a small margin — the real,
// documented scope of the MLIT/JARTIC open traffic observation network. Deliberate honest
// exclusion: the southwest islands (Okinawa/Yaeyama, west of ~128°E) fall outside this envelope
// because a single rectangle wide enough to include them would also swallow Seoul — claiming
// JARTIC coverage over South Korea would be exactly the fabrication this gate exists to prevent.
export const JARTIC_COVERAGE_BBOX: TerraDegreeRectangle = { west: 128.3, south: 30.2, east: 145.9, north: 45.6 }

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasJarticCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, JARTIC_COVERAGE_BBOX)
}

export function buildTerraJarticBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = JARTIC_COVERAGE_BBOX): string | null {
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
