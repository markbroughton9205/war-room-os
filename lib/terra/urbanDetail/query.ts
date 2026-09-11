import { TERRA_URBAN_HIGHWAY_CLASSES, TERRA_URBAN_INCLUDE_BUILDINGS } from './lod'
import type { TerraUrbanBounds, TerraUrbanLod } from './types'

export function buildUrbanOverpassQuery(bounds: TerraUrbanBounds, lod: TerraUrbanLod): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  const highways = TERRA_URBAN_HIGHWAY_CLASSES[lod].join('|')
  const roadClause = `way["highway"~"^(${highways})$"](${bbox});`
  const buildingClause = TERRA_URBAN_INCLUDE_BUILDINGS[lod]
    ? `way["building"](${bbox});relation["building"]["type"="multipolygon"](${bbox});`
    : ''
  return `[out:json][timeout:22][maxsize:16777216];(${roadClause}${buildingClause});out geom;`
}
