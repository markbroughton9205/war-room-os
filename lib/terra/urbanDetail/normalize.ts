/**
 * Pure Overpass JSON → Terra urban roads/buildings/labels. No I/O. Caps and LOD filters are
 * applied here so a dense tile cannot explode the Cesium scene.
 */
import { resolveUrbanBuildingHeight } from './height'
import { isHouseBuildingType, TERRA_URBAN_CITY_STREET_NAME_HIGHWAYS, TERRA_URBAN_HIGHWAY_CLASSES, TERRA_URBAN_INCLUDE_BUILDINGS, TERRA_URBAN_INCLUDE_HOUSE_NUMBERS, TERRA_URBAN_INCLUDE_LABELS, TERRA_URBAN_INCLUDE_SIGNALS, TERRA_URBAN_OBJECT_CAPS } from './lod'
import {
  TERRA_LIVE_SIGNAL_PHASE,
  TERRA_SIGNAL_INFRASTRUCTURE_STATUS,
  type TerraUrbanBuilding,
  type TerraUrbanCoordinate,
  type TerraUrbanLabel,
  type TerraUrbanLod,
  type TerraUrbanRoad,
  type TerraUrbanSignal,
  type TerraUrbanSignalNodeKind,
} from './types'

export type OverpassGeometryPoint = { lat?: number; lon?: number }
export type OverpassMember = {
  type?: string
  role?: string
  geometry?: OverpassGeometryPoint[]
}
export type OverpassElement = {
  type?: string
  id?: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: OverpassGeometryPoint[]
  members?: OverpassMember[]
}
export type OverpassResponse = { elements?: OverpassElement[] }

export type NormalizedUrbanGeometry = {
  roads: TerraUrbanRoad[]
  buildings: TerraUrbanBuilding[]
  signals: TerraUrbanSignal[]
  labels: TerraUrbanLabel[]
  truncated: boolean
}

function asCoordinate(point: OverpassGeometryPoint | undefined): TerraUrbanCoordinate | null {
  if (!point) return null
  const latitude = point.lat
  const longitude = point.lon
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { longitude, latitude }
}

function ringFromGeometry(geometry: OverpassGeometryPoint[] | undefined): TerraUrbanCoordinate[] {
  if (!Array.isArray(geometry) || geometry.length < 2) return []
  const coords: TerraUrbanCoordinate[] = []
  for (const point of geometry) {
    const coord = asCoordinate(point)
    if (coord) coords.push(coord)
  }
  return coords
}

function centroidOf(coords: TerraUrbanCoordinate[]): TerraUrbanCoordinate | null {
  if (coords.length === 0) return null
  let lon = 0
  let lat = 0
  for (const coord of coords) {
    lon += coord.longitude
    lat += coord.latitude
  }
  return { longitude: lon / coords.length, latitude: lat / coords.length }
}

function closeRing(coords: TerraUrbanCoordinate[]): TerraUrbanCoordinate[] {
  if (coords.length < 3) return []
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first.longitude === last.longitude && first.latitude === last.latitude) return coords
  return [...coords, first]
}

function buildingFootprint(element: OverpassElement): TerraUrbanCoordinate[] {
  if (element.type === 'way') return closeRing(ringFromGeometry(element.geometry))
  if (element.type !== 'relation' || !Array.isArray(element.members)) return []
  const outer = element.members.find(member => (member.role === 'outer' || !member.role) && Array.isArray(member.geometry) && member.geometry.length >= 3)
  return closeRing(ringFromGeometry(outer?.geometry))
}

function sourcedField(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatAddress(tags: Record<string, string>): string | null {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:unit'],
    tags['addr:city'],
    tags['addr:postcode'],
  ].filter(part => typeof part === 'string' && part.trim())
  if (parts.length === 0) return tags['addr:full']?.trim() || null
  return parts.join(' ')
}

function highwayAllowed(highway: string, lod: TerraUrbanLod): boolean {
  return (TERRA_URBAN_HIGHWAY_CLASSES[lod] as readonly string[]).includes(highway)
}

function classifySignalNode(tags: Record<string, string>): TerraUrbanSignalNodeKind | null {
  const highway = tags.highway
  const crossing = tags.crossing
  if (highway === 'crossing' && crossing === 'traffic_signals') return 'pedestrian_signal'
  if (highway === 'traffic_signals' && (crossing === 'traffic_signals' || crossing === 'pelican' || crossing === 'toucan')) return 'signalized_crossing'
  if (crossing === 'traffic_signals' && highway !== 'traffic_signals') return 'signalized_crossing'
  if (highway === 'traffic_signals') return 'traffic_light_node'
  return null
}

function dropPriority(building: TerraUrbanBuilding): number {
  if (isHouseBuildingType(building.buildingType)) return 0
  if (building.buildingType === 'apartments' || building.buildingType === 'residential') return 1
  if (building.name) return 2
  if (building.buildingType === 'garage' || building.buildingType === 'shed' || building.buildingType === 'carport') return 9
  return 5
}

export function normalizeOverpassUrbanGeometry(response: OverpassResponse | null | undefined, lod: TerraUrbanLod): NormalizedUrbanGeometry {
  const elements = Array.isArray(response?.elements) ? response!.elements : []
  const caps = TERRA_URBAN_OBJECT_CAPS[lod]
  const allowedHighways = new Set(TERRA_URBAN_HIGHWAY_CLASSES[lod])
  const roads: TerraUrbanRoad[] = []
  const buildings: TerraUrbanBuilding[] = []
  const signals: TerraUrbanSignal[] = []
  const labels: TerraUrbanLabel[] = []
  const seenRoad = new Set<string>()
  const seenBuilding = new Set<string>()
  const seenSignal = new Set<string>()

  if (TERRA_URBAN_INCLUDE_SIGNALS[lod]) {
    for (const element of elements) {
      if (element.type !== 'node' || typeof element.id !== 'number') continue
      const tags = element.tags ?? {}
      const nodeKind = classifySignalNode(tags)
      if (!nodeKind) continue
      const coord = asCoordinate({ lat: element.lat, lon: element.lon })
      if (!coord) continue
      const id = `node/${element.id}`
      if (seenSignal.has(id)) continue
      seenSignal.add(id)
      signals.push({
        id,
        osmType: 'node',
        osmId: element.id,
        nodeKind,
        name: tags.name?.trim() || tags.ref?.trim() || null,
        direction: tags.direction?.trim() || null,
        longitude: coord.longitude,
        latitude: coord.latitude,
        status: TERRA_SIGNAL_INFRASTRUCTURE_STATUS,
        livePhase: TERRA_LIVE_SIGNAL_PHASE,
      })
    }
  }

  for (const element of elements) {
    if ((element.type !== 'way' && element.type !== 'relation') || typeof element.id !== 'number') continue
    const tags = element.tags ?? {}
    const highway = tags.highway
    if (highway && allowedHighways.has(highway) && highwayAllowed(highway, lod)) {
      const geometry = ringFromGeometry(element.geometry)
      if (geometry.length < 2) continue
      const id = `${element.type}/${element.id}`
      if (seenRoad.has(id)) continue
      seenRoad.add(id)
      roads.push({
        id,
        osmType: element.type,
        osmId: element.id,
        highway,
        name: tags.name?.trim() || tags.ref?.trim() || null,
        lanes: sourcedField(tags.lanes),
        maxspeed: sourcedField(tags.maxspeed),
        geometry,
      })
      continue
    }

    if (!TERRA_URBAN_INCLUDE_BUILDINGS[lod]) continue
    if (!tags.building || tags.building === 'no') continue
    const footprint = buildingFootprint(element)
    if (footprint.length < 4) continue
    const id = `${element.type}/${element.id}`
    if (seenBuilding.has(id)) continue
    seenBuilding.add(id)
    const height = resolveUrbanBuildingHeight(tags)
    const center = centroidOf(footprint)
    if (!center) continue
    buildings.push({
      id,
      osmType: element.type,
      osmId: element.id,
      buildingType: tags.building,
      name: tags.name?.trim() || tags['name:en']?.trim() || null,
      address: formatAddress(tags),
      houseNumber: sourcedField(tags['addr:housenumber']),
      streetName: sourcedField(tags['addr:street']),
      entrance: sourcedField(tags.entrance),
      levels: height.levels,
      heightMeters: height.heightMeters,
      heightSource: height.heightSource,
      heightMethod: height.heightMethod,
      footprint,
      longitude: center.longitude,
      latitude: center.latitude,
    })
  }

  roads.sort((a, b) => highwayRank(a.highway) - highwayRank(b.highway))
  buildings.sort((a, b) => dropPriority(a) - dropPriority(b))

  const truncatedRoads = roads.length > caps.roads
  const truncatedBuildings = buildings.length > caps.buildings
  const truncatedSignals = signals.length > caps.signals
  const keptRoads = roads.slice(0, caps.roads)
  const keptBuildings = buildings.slice(0, caps.buildings)
  const keptSignals = signals.slice(0, caps.signals)

  if (TERRA_URBAN_INCLUDE_LABELS[lod]) {
    const cityHighways = new Set<string>(TERRA_URBAN_CITY_STREET_NAME_HIGHWAYS)
    let streetLabelCount = 0
    for (const road of keptRoads) {
      if (!road.name) continue
      if (lod === 'city' && !cityHighways.has(road.highway)) continue
      if (streetLabelCount >= caps.streetLabels) break
      const center = centroidOf(road.geometry)
      if (!center) continue
      labels.push({
        id: `street:${road.id}`,
        osmId: road.osmId,
        kind: 'street',
        text: road.name,
        longitude: center.longitude,
        latitude: center.latitude,
      })
      streetLabelCount += 1
    }
    if (TERRA_URBAN_INCLUDE_HOUSE_NUMBERS[lod]) {
      let houseLabelCount = 0
      for (const building of keptBuildings) {
        if (!building.houseNumber) continue
        if (houseLabelCount >= caps.houseNumbers) break
        labels.push({
          id: `house:${building.id}`,
          osmId: building.osmId,
          kind: 'house_number',
          text: building.houseNumber,
          longitude: building.longitude,
          latitude: building.latitude,
        })
        houseLabelCount += 1
      }
    }
  }

  const streetLabelCount = labels.filter(label => label.kind === 'street').length
  const houseLabelCount = labels.filter(label => label.kind === 'house_number').length
  const cityHighwaysForCap = new Set<string>(TERRA_URBAN_CITY_STREET_NAME_HIGHWAYS)
  const namedRoads = keptRoads.filter(road => Boolean(road.name) && (lod !== 'city' || cityHighwaysForCap.has(road.highway))).length
  const numberedBuildings = keptBuildings.filter(building => Boolean(building.houseNumber)).length
  return {
    roads: keptRoads,
    buildings: keptBuildings,
    signals: keptSignals,
    labels,
    truncated: truncatedRoads || truncatedBuildings || truncatedSignals || namedRoads > streetLabelCount || numberedBuildings > houseLabelCount,
  }
}

function highwayRank(highway: string): number {
  const order = [
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
    'residential', 'unclassified', 'living_street', 'service',
  ]
  const index = order.indexOf(highway)
  return index === -1 ? 99 : index
}
