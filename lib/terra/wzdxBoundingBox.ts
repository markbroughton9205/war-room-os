/**
 * Terra WZDx work-zone layers -> bounding-box query, mirroring
 * lib/terra/ontarioBoundingBox.ts's convention, one coverage envelope per feed (the three feeds
 * this phase integrated are state-scoped, not national): WSDOT (Washington), Iowa DOT (Iowa),
 * KYTC (Kentucky). The feeds themselves have no bounding-box parameter — they always return the
 * full state feed — so lib/research-engine/providers/wzdx_shared.ts filters client-side, same
 * "lamin,lomin,lamax,lomax" shape as the Digitraffic/Ontario family.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'

const MAX_BBOX_SPAN_DEG = 8

// Real state extents + a small margin — the real, documented scope of each state DOT's feed.
export const WZDX_COVERAGE_BBOXES = {
  wzdx_wsdot: { west: -124.8, south: 45.5, east: -116.9, north: 49.1 },
  wzdx_iowa_dot: { west: -96.7, south: 40.3, east: -90.1, north: 43.6 },
  wzdx_kytc: { west: -89.6, south: 36.4, east: -81.9, north: 39.2 },
} as const satisfies Record<string, TerraDegreeRectangle>

export type WzdxProviderId = keyof typeof WZDX_COVERAGE_BBOXES

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function terraCameraViewHasWzdxCoverage(rectangle: TerraDegreeRectangle | null, providerId: ResearchProviderId): boolean {
  if (!rectangle) return false
  const coverage = WZDX_COVERAGE_BBOXES[providerId as WzdxProviderId]
  if (!coverage) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, coverage)
}

export function buildTerraWzdxBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, providerId: ResearchProviderId): string | null {
  if (!rectangle) return null
  const coverage = WZDX_COVERAGE_BBOXES[providerId as WzdxProviderId]
  if (!coverage) return null
  const { west, south, east, north } = rectangle
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (east <= west || north <= south) return null
  if (east - west > MAX_BBOX_SPAN_DEG || north - south > MAX_BBOX_SPAN_DEG) return null
  if (!rectanglesIntersect(rectangle, coverage)) return null

  const clampedSouth = Math.max(-90, Math.min(90, south))
  const clampedNorth = Math.max(-90, Math.min(90, north))
  const clampedWest = Math.max(-180, Math.min(180, west))
  const clampedEast = Math.max(-180, Math.min(180, east))
  if (clampedEast <= clampedWest || clampedNorth <= clampedSouth) return null

  return `${clampedSouth.toFixed(2)},${clampedWest.toFixed(2)},${clampedNorth.toFixed(2)},${clampedEast.toFixed(2)}`
}
