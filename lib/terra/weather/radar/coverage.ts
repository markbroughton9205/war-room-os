import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import { IEM_USCOMP_COVERAGE } from './types'

function unwrapWestEast(west: number, east: number): { west: number; east: number } {
  if (east < west) return { west, east: east + 360 }
  return { west, east }
}

export function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  const A = unwrapWestEast(a.west, a.east)
  const B = unwrapWestEast(b.west, b.east)
  const lonOverlap = A.west < B.east && A.east > B.west
  const latOverlap = a.south < b.north && a.north > b.south
  return lonOverlap && latOverlap
}

export function pointInRadarCoverage(latitude: number, longitude: number): boolean {
  return longitude >= IEM_USCOMP_COVERAGE.west
    && longitude <= IEM_USCOMP_COVERAGE.east
    && latitude >= IEM_USCOMP_COVERAGE.south
    && latitude <= IEM_USCOMP_COVERAGE.north
}

export function viewIntersectsRadarCoverage(view: TerraDegreeRectangle | null): boolean {
  if (!view) return true
  return rectanglesIntersect(view, IEM_USCOMP_COVERAGE)
}

/**
 * True only when the whole view sits inside the mosaic domain. A view that merely overlaps is
 * PARTIAL coverage and must not be presented as fully radar-covered.
 */
export function viewWithinRadarCoverage(view: TerraDegreeRectangle | null): boolean {
  if (!view) return false
  const v = unwrapWestEast(view.west, view.east)
  const c = unwrapWestEast(IEM_USCOMP_COVERAGE.west, IEM_USCOMP_COVERAGE.east)
  return v.west >= c.west
    && v.east <= c.east
    && view.south >= IEM_USCOMP_COVERAGE.south
    && view.north <= IEM_USCOMP_COVERAGE.north
}

/** Honest human description of the radar domain — never "worldwide". */
export function radarCoverageLabel(): string {
  const c = IEM_USCOMP_COVERAGE
  return `CONUS mosaic · ${c.south}°–${c.north}°N, ${Math.abs(c.west)}°–${Math.abs(c.east)}°W`
}
