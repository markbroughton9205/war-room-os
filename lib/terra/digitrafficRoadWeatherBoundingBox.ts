/**
 * Terra Road Weather layer -> digitraffic_road_weather bounding-box query. Deliberately reuses
 * lib/terra/roadCameraBoundingBox.ts's real DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX constant rather
 * than duplicating it — road weather and road cameras are the exact same Fintraffic national road
 * network, a genuinely shared coverage envelope, not a coincidence worth re-deriving. Only the
 * query-string builder is separate (its own coverage module per this codebase's established
 * one-module-per-provider convention).
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'
import { DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX } from './roadCameraBoundingBox'

const MAX_BBOX_SPAN_DEG = 20
const BBOX_GRID_DEG = 0.1

export const DIGITRAFFIC_ROAD_WEATHER_COVERAGE_BBOX: TerraDegreeRectangle = DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX

function snapDown(value: number): number {
  return Math.floor(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function snapUp(value: number): number {
  return Math.ceil(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasRoadWeatherCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, DIGITRAFFIC_ROAD_WEATHER_COVERAGE_BBOX)
}

export function buildTerraRoadWeatherBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = DIGITRAFFIC_ROAD_WEATHER_COVERAGE_BBOX): string | null {
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
