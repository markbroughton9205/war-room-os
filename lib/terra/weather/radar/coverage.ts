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
