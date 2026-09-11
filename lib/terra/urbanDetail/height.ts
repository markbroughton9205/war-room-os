/**
 * Building height truth for Terra urban extrusion.
 *
 * Priority:
 *   1. OSM `height` tag → SOURCE
 *   2. OSM `building:levels` × documented 3.0 m floor height → INFERRED
 *   3. Conservative type default → INFERRED
 *
 * Defaults are deliberately modest so houses do not become office towers. They are never
 * presented as measured heights.
 */
import { TERRA_URBAN_FLOOR_HEIGHT_M } from './lod'
import type { TerraUrbanHeightMethod, TerraUrbanHeightSource } from './types'

const MAX_HEIGHT_M = 800
const MIN_HEIGHT_M = 2.2

const TYPE_DEFAULT_HEIGHT_M: Record<string, number> = {
  house: 6,
  detached: 6,
  semidetached_house: 6.5,
  terrace: 7,
  bungalow: 4.5,
  static_caravan: 3.2,
  cabin: 4.5,
  allotment_house: 3.5,
  residential: 7,
  apartments: 12,
  maisonette: 8,
  duplex: 7,
  farm: 6,
  garage: 3,
  garages: 3,
  shed: 2.5,
  carport: 2.5,
  kiosk: 3,
  retail: 8,
  commercial: 9,
  office: 12,
  hotel: 14,
  industrial: 8,
  warehouse: 8,
  hangar: 10,
  church: 12,
  cathedral: 18,
  chapel: 8,
  school: 10,
  university: 12,
  hospital: 12,
  civic: 10,
  public: 10,
  stadium: 16,
  sports_hall: 10,
  supermarket: 8,
  yes: 7,
}

export type TerraUrbanHeightResolution = {
  heightMeters: number
  heightSource: TerraUrbanHeightSource
  heightMethod: TerraUrbanHeightMethod
  levels: number | null
}

export function parseOsmHeightMeters(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= MIN_HEIGHT_M && raw <= MAX_HEIGHT_M ? raw : null
  }
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase().replace(',', '.')
  if (!trimmed) return null
  const match = /^(\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres|ft|feet|'|′)?$/.exec(trimmed)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2]
  const meters = unit === 'ft' || unit === 'feet' || unit === "'" || unit === '′' ? value * 0.3048 : value
  if (meters < MIN_HEIGHT_M || meters > MAX_HEIGHT_M) return null
  return meters
}

export function parseOsmBuildingLevels(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 && raw <= 200 ? raw : null
  }
  if (typeof raw !== 'string') return null
  const first = raw.trim().split(/[;,/]/)[0]?.trim().replace(',', '.')
  if (!first) return null
  const value = Number(first)
  if (!Number.isFinite(value) || value <= 0 || value > 200) return null
  return value
}

export function defaultHeightForBuildingType(buildingType: string | null | undefined): number {
  if (!buildingType) return TYPE_DEFAULT_HEIGHT_M.yes
  return TYPE_DEFAULT_HEIGHT_M[buildingType] ?? TYPE_DEFAULT_HEIGHT_M.yes
}

export function resolveUrbanBuildingHeight(tags: Record<string, string> | null | undefined): TerraUrbanHeightResolution {
  const safeTags = tags ?? {}
  const fromHeight = parseOsmHeightMeters(safeTags.height ?? safeTags['building:height'])
  const levels = parseOsmBuildingLevels(safeTags['building:levels'])
  if (fromHeight !== null) {
    return { heightMeters: roundHeight(fromHeight), heightSource: 'SOURCE', heightMethod: 'height_tag', levels }
  }
  if (levels !== null) {
    return {
      heightMeters: roundHeight(Math.max(MIN_HEIGHT_M, Math.min(MAX_HEIGHT_M, levels * TERRA_URBAN_FLOOR_HEIGHT_M))),
      heightSource: 'INFERRED',
      heightMethod: 'building_levels',
      levels,
    }
  }
  return {
    heightMeters: roundHeight(defaultHeightForBuildingType(safeTags.building)),
    heightSource: 'INFERRED',
    heightMethod: 'type_default',
    levels: null,
  }
}

function roundHeight(meters: number): number {
  return Math.round(meters * 10) / 10
}
