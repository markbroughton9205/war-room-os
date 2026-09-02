/**
 * Terra Traffic Flow layer -> webtris bounding-box query, mirroring lib/terra/roadCameraBoundingBox.ts's
 * exact convention. webtris's own /sites endpoint has no bounding-box parameter — it always returns
 * every MIDAS/TAME site nationwide (20,000+) — so lib/research-engine/providers/webtris.ts filters
 * that always-whole-network response to this bbox client-side.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 8
const BBOX_GRID_DEG = 0.1

// England's strategic road network (National Highways' real jurisdiction) + a small margin — real
// site coordinates observed live this build span roughly lat 50.1-55.8, lon -5.5 to 1.8.
export const WEBTRIS_COVERAGE_BBOX: TerraDegreeRectangle = { west: -5.7, south: 49.9, east: 2.0, north: 56.0 }

function snapDown(value: number): number {
  return Math.floor(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function snapUp(value: number): number {
  return Math.ceil(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasWebtrisCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, WEBTRIS_COVERAGE_BBOX)
}

export function buildTerraWebtrisBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = WEBTRIS_COVERAGE_BBOX): string | null {
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

  const lamin = snapDown(clampedSouth).toFixed(1)
  const lomin = snapDown(clampedWest).toFixed(1)
  const lamax = snapUp(clampedNorth).toFixed(1)
  const lomax = snapUp(clampedEast).toFixed(1)
  return `${lamin},${lomin},${lamax},${lomax}`
}
