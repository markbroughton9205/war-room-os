import type { TerraUrbanBuilding, TerraUrbanRoad, TerraUrbanSelection, TerraUrbanSignal } from './types'

export const TERRA_URBAN_BUILDING_ENTITY_PREFIX = 'terra-urban-building:'
export const TERRA_URBAN_SIGNAL_ENTITY_PREFIX = 'terra-urban-signal:'

export type TerraUrbanBuildingPickId = {
  terraUrban: true
  kind: 'building'
  building?: TerraUrbanBuilding
  buildingId?: string
}

export type TerraUrbanRoadPickId = {
  terraUrban: true
  kind: 'road'
  roadId?: string
  road?: TerraUrbanRoad
}

export type TerraUrbanSignalPickId = {
  terraUrban: true
  kind: 'signal'
  signalId?: string
  signal?: TerraUrbanSignal
}

const urbanBuildingsById = new Map<string, TerraUrbanBuilding>()
const urbanRoadsById = new Map<string, TerraUrbanRoad>()
const urbanSignalsById = new Map<string, TerraUrbanSignal>()

export function registerUrbanBuildingsForPick(buildings: TerraUrbanBuilding[]): void {
  urbanBuildingsById.clear()
  for (const building of buildings) urbanBuildingsById.set(building.id, building)
}

export function registerUrbanRoadsForPick(roads: TerraUrbanRoad[]): void {
  urbanRoadsById.clear()
  for (const road of roads) urbanRoadsById.set(road.id, road)
}

export function registerUrbanSignalsForPick(signals: TerraUrbanSignal[]): void {
  urbanSignalsById.clear()
  for (const signal of signals) urbanSignalsById.set(signal.id, signal)
}

export function registerUrbanGeometryForPick(input: {
  buildings: TerraUrbanBuilding[]
  roads: TerraUrbanRoad[]
  signals: TerraUrbanSignal[]
}): void {
  registerUrbanBuildingsForPick(input.buildings)
  registerUrbanRoadsForPick(input.roads)
  registerUrbanSignalsForPick(input.signals)
}

export function clearUrbanBuildingsForPick(): void {
  urbanBuildingsById.clear()
  urbanRoadsById.clear()
  urbanSignalsById.clear()
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
    osmId: String(building.osmId),
    osmType: building.osmType,
    buildingType: building.buildingType,
    name: building.name,
    address: building.address,
    houseNumber: building.houseNumber,
    streetName: building.streetName,
    entrance: building.entrance,
    overtureId: null,
    gersId: null,
    levels: building.levels,
    heightMeters: building.heightMeters,
    heightSource: building.heightSource,
    heightMethod: building.heightMethod,
    footprint: building.footprint,
    longitude: building.longitude,
    latitude: building.latitude,
    provider: 'osm_overpass',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function isTerraUrbanRoadPick(id: unknown): id is TerraUrbanRoadPickId {
  if (!isRecord(id)) return false
  return id.terraUrban === true && id.kind === 'road'
}

export function isTerraUrbanSignalPick(id: unknown): id is TerraUrbanSignalPickId {
  if (!isRecord(id)) return false
  return id.terraUrban === true && id.kind === 'signal'
}

function signalFromEntityId(entityId: unknown): TerraUrbanSignal | null {
  if (typeof entityId !== 'string' || !entityId.startsWith(TERRA_URBAN_SIGNAL_ENTITY_PREFIX)) return null
  return urbanSignalsById.get(entityId.slice(TERRA_URBAN_SIGNAL_ENTITY_PREFIX.length)) ?? null
}

export function resolveTerraUrbanSignalFromPick(pickedId: unknown): TerraUrbanSignal | null {
  const fromEntityId = signalFromEntityId(pickedId)
  if (fromEntityId) return fromEntityId
  if (isRecord(pickedId) && 'id' in pickedId) {
    const nested = signalFromEntityId(pickedId.id)
    if (nested) return nested
  }
  if (!isTerraUrbanSignalPick(pickedId)) return null
  if (pickedId.signal && typeof pickedId.signal === 'object') return pickedId.signal
  if (typeof pickedId.signalId === 'string') return urbanSignalsById.get(pickedId.signalId) ?? null
  return null
}

export function resolveTerraUrbanRoadFromPick(pickedId: unknown): TerraUrbanRoad | null {
  if (typeof pickedId === 'string' && urbanRoadsById.has(pickedId)) return urbanRoadsById.get(pickedId) ?? null
  if (!isTerraUrbanRoadPick(pickedId)) return null
  if (pickedId.road && typeof pickedId.road === 'object') return pickedId.road
  if (typeof pickedId.roadId === 'string') return urbanRoadsById.get(pickedId.roadId) ?? null
  return null
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function distPointToSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist2(px, py, ax, ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return dist2(px, py, ax + t * dx, ay + t * dy)
}

const SIGNAL_HIT_DEG2 = 0.00032 * 0.00032
const ROAD_HIT_DEG2 = 0.00028 * 0.00028

export function findUrbanSignalAt(longitude: number, latitude: number): TerraUrbanSignal | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  let best: TerraUrbanSignal | null = null
  let bestDist = SIGNAL_HIT_DEG2
  for (const signal of urbanSignalsById.values()) {
    const d = dist2(longitude, latitude, signal.longitude, signal.latitude)
    if (d < bestDist) {
      best = signal
      bestDist = d
    }
  }
  return best
}

export function findUrbanRoadAt(longitude: number, latitude: number): TerraUrbanRoad | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  let best: TerraUrbanRoad | null = null
  let bestDist = ROAD_HIT_DEG2
  for (const road of urbanRoadsById.values()) {
    const geometry = road.geometry
    for (let i = 1; i < geometry.length; i++) {
      const prev = geometry[i - 1]
      const next = geometry[i]
      const d = distPointToSegment2(longitude, latitude, prev.longitude, prev.latitude, next.longitude, next.latitude)
      if (d < bestDist) {
        best = road
        bestDist = d
      }
    }
  }
  return best
}
