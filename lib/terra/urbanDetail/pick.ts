import type { TerraUrbanBuilding, TerraUrbanSelection } from './types'

export const TERRA_URBAN_BUILDING_ENTITY_PREFIX = 'terra-urban-building:'

export type TerraUrbanBuildingPickId = {
  terraUrban: true
  kind: 'building'
  building?: TerraUrbanBuilding
  buildingId?: string
}

const urbanBuildingsById = new Map<string, TerraUrbanBuilding>()

export function registerUrbanBuildingsForPick(buildings: TerraUrbanBuilding[]): void {
  urbanBuildingsById.clear()
  for (const building of buildings) urbanBuildingsById.set(building.id, building)
}

export function clearUrbanBuildingsForPick(): void {
  urbanBuildingsById.clear()
}

export function isTerraUrbanBuildingPick(id: unknown): id is TerraUrbanBuildingPickId {
  if (!id || typeof id !== 'object') return false
  const record = id as { terraUrban?: unknown; kind?: unknown; building?: unknown; buildingId?: unknown }
  if (record.terraUrban !== true || record.kind !== 'building') return false
  return Boolean(record.building && typeof record.building === 'object') || typeof record.buildingId === 'string'
}

function buildingFromEntityId(entityId: unknown): TerraUrbanBuilding | null {
  if (typeof entityId !== 'string' || !entityId.startsWith(TERRA_URBAN_BUILDING_ENTITY_PREFIX)) return null
  return urbanBuildingsById.get(entityId.slice(TERRA_URBAN_BUILDING_ENTITY_PREFIX.length)) ?? null
}

function pointInRing(longitude: number, latitude: number, ring: TerraUrbanBuilding['footprint']): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude
    const yi = ring[i].latitude
    const xj = ring[j].longitude
    const yj = ring[j].latitude
    const intersects = (yi > latitude) !== (yj > latitude) && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function footprintSpan(ring: TerraUrbanBuilding['footprint']): number {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const coord of ring) {
    minLon = Math.min(minLon, coord.longitude)
    minLat = Math.min(minLat, coord.latitude)
    maxLon = Math.max(maxLon, coord.longitude)
    maxLat = Math.max(maxLat, coord.latitude)
  }
  return (maxLon - minLon) * (maxLat - minLat)
}

export function findUrbanBuildingAt(longitude: number, latitude: number): TerraUrbanBuilding | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  let best: TerraUrbanBuilding | null = null
  let bestSpan = Infinity
  for (const building of urbanBuildingsById.values()) {
    if (!pointInRing(longitude, latitude, building.footprint)) continue
    const span = footprintSpan(building.footprint)
    if (span < bestSpan) {
      best = building
      bestSpan = span
    }
  }
  return best
}

export function resolveTerraUrbanBuildingFromPick(pickedId: unknown): TerraUrbanBuilding | null {
  const fromEntityId = buildingFromEntityId(pickedId)
  if (fromEntityId) return fromEntityId
  if (pickedId && typeof pickedId === 'object' && 'id' in pickedId) {
    const nested = buildingFromEntityId((pickedId as { id: unknown }).id)
    if (nested) return nested
  }
  if (!isTerraUrbanBuildingPick(pickedId)) return null
  if (pickedId.building && typeof pickedId.building === 'object') return pickedId.building
  if (typeof pickedId.buildingId === 'string') return urbanBuildingsById.get(pickedId.buildingId) ?? null
  return null
}

export function urbanBuildingToSelection(building: TerraUrbanBuilding): TerraUrbanSelection {
  return {
    osmId: building.id,
    osmType: building.osmType,
    buildingType: building.buildingType,
    name: building.name,
    address: building.address,
    levels: building.levels,
    heightMeters: building.heightMeters,
    heightSource: building.heightSource,
    heightMethod: building.heightMethod,
    footprint: building.footprint,
    longitude: building.longitude,
    latitude: building.latitude,
  }
}
