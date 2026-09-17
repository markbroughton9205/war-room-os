/**
 * California statewide envelope for Caltrans CWWP2 still cameras.
 * District JSON files have no bbox param — adapters fetch intersecting districts only.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 8
const MAX_DISTRICTS_PER_QUERY = 4

export const CALTRANS_COVERAGE_BBOX: TerraDegreeRectangle = { west: -124.55, south: 32.50, east: -114.10, north: 42.05 }

export type CaltransDistrict = {
  id: string
  statusUrl: string
  bbox: TerraDegreeRectangle
}

export const CALTRANS_DISTRICT_BBOXES: { id: string; bbox: TerraDegreeRectangle }[] = [
  { id: '01', bbox: { west: -124.55, south: 38.70, east: -122.40, north: 42.05 } },
  { id: '02', bbox: { west: -122.55, south: 39.50, east: -119.90, north: 42.05 } },
  { id: '03', bbox: { west: -122.40, south: 38.00, east: -119.50, north: 39.85 } },
  { id: '04', bbox: { west: -123.15, south: 36.90, east: -121.20, north: 38.90 } },
  { id: '05', bbox: { west: -122.40, south: 34.40, east: -119.50, north: 37.30 } },
  { id: '06', bbox: { west: -120.70, south: 34.80, east: -118.50, north: 37.20 } },
  { id: '07', bbox: { west: -119.35, south: 33.30, east: -117.60, north: 34.90 } },
  { id: '08', bbox: { west: -118.05, south: 33.40, east: -114.10, north: 35.80 } },
  { id: '09', bbox: { west: -119.30, south: 35.30, east: -117.60, north: 38.80 } },
  { id: '10', bbox: { west: -121.80, south: 37.00, east: -119.70, north: 38.70 } },
  { id: '11', bbox: { west: -117.65, south: 32.50, east: -114.50, north: 33.65 } },
  { id: '12', bbox: { west: -118.15, south: 33.38, east: -117.50, north: 33.98 } },
]

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

export function caltransDistrictStatusUrl(id: string): string {
  const padded = id.padStart(2, '0')
  return `https://cwwp2.dot.ca.gov/data/d${Number(padded)}/cctv/cctvStatusD${padded}.json`
}

export function terraCameraViewHasCaltransCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, CALTRANS_COVERAGE_BBOX)
}

export function caltransDistrictsIntersecting(rectangle: TerraDegreeRectangle): string[] {
  return CALTRANS_DISTRICT_BBOXES.filter(row => rectanglesIntersect(rectangle, row.bbox)).map(row => row.id)
}

export function caltransDistrictsForRectangle(rectangle: TerraDegreeRectangle): CaltransDistrict[] {
  return CALTRANS_DISTRICT_BBOXES
    .filter(row => rectanglesIntersect(rectangle, row.bbox))
    .slice(0, MAX_DISTRICTS_PER_QUERY)
    .map(row => ({
      id: row.id,
      bbox: row.bbox,
      statusUrl: caltransDistrictStatusUrl(row.id),
    }))
}

export function buildTerraCaltransBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = CALTRANS_COVERAGE_BBOX): string | null {
  if (!rectangle) return null
  const { west, south, east, north } = rectangle
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (east <= west || north <= south) return null
  if (east - west > MAX_BBOX_SPAN_DEG || north - south > MAX_BBOX_SPAN_DEG) return null
  if (!rectanglesIntersect(rectangle, coverageBbox)) return null
  if (caltransDistrictsIntersecting(rectangle).length === 0) return null
  return `${south.toFixed(2)},${west.toFixed(2)},${north.toFixed(2)},${east.toFixed(2)}`
}
