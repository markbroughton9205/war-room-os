/**
 * Terra Traffic Camera layer -> digitraffic_road_cameras bounding-box query string, mirroring
 * lib/terra/maritimeBoundingBox.ts's exact convention (same TerraDegreeRectangle type, same
 * grid-snap-for-cache behavior, same coverage-envelope gate) for Digitraffic's sibling road-camera
 * API. digitraffic_road_cameras' own /stations endpoint has no bounding-box parameter — it always
 * returns every weathercam station in Finland (~500+ stations) — so
 * lib/research-engine/providers/digitraffic_road_cameras.ts filters that always-whole-country
 * response to this bbox server-side, exactly like digitraffic_marine.ts already does for vessels.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 20
const BBOX_GRID_DEG = 0.1

// Mainland Finland + a small margin — the real, documented scope of Digitraffic's road-weathercam
// network (Finnish Transport Infrastructure Agency road network only, not a global camera
// registry).
export const DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX: TerraDegreeRectangle = { west: 19.0, south: 59.5, east: 31.6, north: 70.2 }

function snapDown(value: number): number {
  return Math.floor(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function snapUp(value: number): number {
  return Math.ceil(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

/** True only when the given camera rectangle genuinely overlaps digitraffic_road_cameras' real
 * coverage envelope — independent of whether the layer is actually enabled. */
export function terraCameraViewHasRoadCameraCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX)
}

export function buildTerraRoadCameraBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX): string | null {
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
