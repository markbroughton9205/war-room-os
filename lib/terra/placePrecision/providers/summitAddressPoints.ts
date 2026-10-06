import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import { fetchTerraOfficialGis, sqlLiteral } from '../gisFetch'
import { stripOwnerLikeFields } from '../privacy'
import type { PrecisionHit, PrecisionLookupQuery, PrecisionLookupResult, PrecisionProvider } from './types'

export const SUMMIT_ADDRESS_POINTS_URL =
  'https://scgis.summitoh.net/hosted/rest/services/Address/Address_Points/FeatureServer/0/query'
export const SUMMIT_BUILDINGS_URL =
  'https://scgis.summitoh.net/hosted/rest/services/Building_Footprints/MapServer/0/query'
export const SUMMIT_PARCELS_URL =
  'https://scgis.summitoh.net/hosted/rest/services/Parcel_Layer_for_EAM/FeatureServer/0/query'

const SUMMIT_BBOX = { west: -81.78, east: -81.30, south: 40.85, north: 41.42 }
const SUMMIT_CITIES = new Set([
  'akron', 'cuyahoga falls', 'barberton', 'stow', 'copley', 'fairlawn', 'tallmadge',
  'macedonia', 'twinsburg', 'hudson', 'green', 'norton', 'munroe falls', 'silver lake',
  'richfield', 'boston heights', 'peninsula', 'mogadore', 'new franklin', 'lakemore',
])
const SUMMIT_ZIP_PREFIX = /^44(3\d{2}|278|285|221|224|236|203|162|133)$/
const ADDRESS_FIELDS = 'ADDR_NUM,PRE_DIR,STR_NAME,STR_TYPE,SUF_DIR,UNIT_NUM,CITY,ZIP,STATE'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

type ArcGisFeature = {
  attributes?: Record<string, unknown>
  geometry?: { x?: number; y?: number; rings?: number[][][]; paths?: number[][][] }
}

function inSummitHint(query: PrecisionLookupQuery): boolean {
  const parsed = query.parsed
  if (parsed.countryCode && parsed.countryCode !== 'US') return false
  if (parsed.stateProvince && !/^(OH|Ohio)$/i.test(parsed.stateProvince)) return false
  if (parsed.city && SUMMIT_CITIES.has(parsed.city.trim().toLowerCase())) return true
  if (parsed.postalCode && SUMMIT_ZIP_PREFIX.test(parsed.postalCode.replace('-', '').slice(0, 5))) return true
  const hint = query.hint
  if (hint) {
    return hint.longitude >= SUMMIT_BBOX.west && hint.longitude <= SUMMIT_BBOX.east
      && hint.latitude >= SUMMIT_BBOX.south && hint.latitude <= SUMMIT_BBOX.north
  }
  return parsed.stateProvince === 'OH' && Boolean(parsed.city)
}

function attrString(attributes: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = attributes[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function featureToHit(feature: ArcGisFeature): PrecisionHit | null {
  const attributes = stripOwnerLikeFields(feature.attributes)
  const houseNumber = attrString(attributes, 'ADDR_NUM')
  const streetName = attrString(attributes, 'STR_NAME')
  const streetType = attrString(attributes, 'STR_TYPE')
  const longitude = Number(feature.geometry?.x)
  const latitude = Number(feature.geometry?.y)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  if (!houseNumber || !streetName || !streetType) return null
  const city = attrString(attributes, 'CITY')
  const postcode = attrString(attributes, 'ZIP')
  const state = attrString(attributes, 'STATE') ?? 'OH'
  const pre = attrString(attributes, 'PRE_DIR')
  const post = attrString(attributes, 'SUF_DIR')
  const unit = attrString(attributes, 'UNIT_NUM', 'UNIT')
  const label = [houseNumber, pre, streetName, streetType, post, unit, city, state, postcode].filter(Boolean).join(' ')
  return {
    providerId: 'summit_address_points',
    source: 'County of Summit GIS Address Points',
    matchClass: 'ADDRESS_POINT',
    longitude,
    latitude,
    houseNumber,
    preDirectional: pre,
    streetName,
    streetTypeAbbrev: streetType.toUpperCase(),
    postDirectional: post,
    unit,
    city,
    state,
    postcode,
    label,
    geometryKind: 'point',
    ring: null,
    boundingBox: null,
    providerPrecisionSignal: 'address_point',
    provenance: SUMMIT_ADDRESS_POINTS_URL,
  }
}

function hardWhere(query: PrecisionLookupQuery): string | null {
  const parsed = query.parsed
  if (!parsed.houseNumber || !parsed.streetStem || !parsed.streetTypeAbbrev) return null
  const clauses = [
    `ADDR_NUM=${sqlLiteral(parsed.houseNumber)}`,
    `UPPER(STR_NAME)=${sqlLiteral(parsed.streetStem.toUpperCase())}`,
    `UPPER(STR_TYPE)=${sqlLiteral(parsed.streetTypeAbbrev.toUpperCase())}`,
  ]
  if (parsed.preDirectional) clauses.push(`UPPER(PRE_DIR)=${sqlLiteral(parsed.preDirectional)}`)
  if (parsed.postDirectional) clauses.push(`UPPER(SUF_DIR)=${sqlLiteral(parsed.postDirectional)}`)
  if (parsed.postalCode) clauses.push(`ZIP=${sqlLiteral(parsed.postalCode.slice(0, 5))}`)
  return clauses.join(' AND ')
}

async function queryJson(url: string, params: Record<string, string>, signal?: AbortSignal): Promise<{ health: PrecisionLookupResult['health']; features: ArcGisFeature[]; reason?: string }> {
  const target = new URL(url)
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  const result = await fetchTerraOfficialGis({ service: 'summit_gis', url: target.toString(), signal, timeoutMs: 6_000 })
  if (!result.ok) {
    if (result.status === 429) return { health: 'RATE_LIMITED', features: [], reason: 'Summit GIS rate limited.' }
    if (result.status === 401 || result.status === 403) return { health: 'AUTH_REQUIRED', features: [], reason: 'Summit GIS authorization required.' }
    return { health: 'UNAVAILABLE', features: [], reason: result.text || `Summit GIS HTTP ${result.status}.` }
  }
  try {
    const payload = JSON.parse(result.text) as { features?: ArcGisFeature[]; error?: { message?: string } }
    if (payload.error?.message) return { health: 'UNAVAILABLE', features: [], reason: payload.error.message }
    return { health: 'AVAILABLE', features: payload.features ?? [] }
  } catch {
    return { health: 'UNAVAILABLE', features: [], reason: 'Summit GIS returned malformed JSON.' }
  }
}

export const summitAddressPointProvider: PrecisionProvider = {
  id: 'summit_address_points',
  label: 'County of Summit GIS',
  pluginFlag: 'summit_address_points',
  supports(query) {
    return query.parsed.addressLike && inSummitHint(query)
  },
  async lookupAddressPoints(query) {
    const where = hardWhere(query)
    if (!where) return { health: 'NO_DATA', hits: [], reason: 'Structured house/street/type required.' }
    const cacheKey = `terra-precision:summit-ap:${where}`
    const cached = cacheGet<PrecisionLookupResult>(cacheKey)
    if (cached) return cached
    const queried = await queryJson(SUMMIT_ADDRESS_POINTS_URL, {
      where,
      outFields: ADDRESS_FIELDS,
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    }, query.signal)
    if (queried.health !== 'AVAILABLE') {
      const result: PrecisionLookupResult = { health: queried.health, hits: [], reason: queried.reason ?? 'Summit GIS unavailable.' }
      return result
    }
    const hits = queried.features.map(featureToHit).filter((row): row is PrecisionHit => row !== null)
    const result: PrecisionLookupResult = hits.length
      ? { health: 'AVAILABLE', hits }
      : { health: 'NO_DATA', hits: [], reason: 'Summit address-point layer returned no matching house/street/type.' }
    cacheSet(cacheKey, result, CACHE_TTL_MS)
    return result
  },
  async lookupBuildings(query) {
    const { longitude, latitude } = query.around
    const pad = 0.00025
    const queried = await queryJson(SUMMIT_BUILDINGS_URL, {
      geometry: `${longitude - pad},${latitude - pad},${longitude + pad},${latitude + pad}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'OBJECTID,TYPE',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    }, query.signal)
    if (queried.health !== 'AVAILABLE') {
      return { health: queried.health, hits: [], reason: queried.reason ?? 'Summit buildings unavailable.' }
    }
    const hits: PrecisionHit[] = []
    for (const feature of queried.features) {
      const ring = feature.geometry?.rings?.[0]?.map(pair => ({ longitude: pair[0], latitude: pair[1] })) ?? null
      if (!ring || ring.length < 3) continue
      const inside = pointInRing(query.around, ring)
      if (!inside && minDistanceMeters(query.around, ring) > 18) continue
      hits.push({
        providerId: 'summit_address_points',
        source: 'County of Summit GIS Building Footprints',
        matchClass: 'BUILDING',
        longitude,
        latitude,
        houseNumber: query.parsed.houseNumber,
        preDirectional: query.parsed.preDirectional,
        streetName: query.parsed.streetName,
        streetTypeAbbrev: query.parsed.streetTypeAbbrev,
        postDirectional: query.parsed.postDirectional,
        unit: query.parsed.unit,
        city: query.parsed.city,
        state: query.parsed.stateProvince,
        postcode: query.parsed.postalCode,
        label: query.parsed.name ?? 'Summit building',
        geometryKind: 'polygon',
        ring,
        boundingBox: ringBounds(ring),
        providerPrecisionSignal: 'building_footprint',
        provenance: SUMMIT_BUILDINGS_URL,
      })
    }
    if (hits.length !== 1) {
      return { health: hits.length === 0 ? 'NO_DATA' : 'AVAILABLE', hits: [], reason: hits.length === 0 ? 'No unique building footprint.' : 'Multiple plausible buildings — not promoted.' }
    }
    return { health: 'AVAILABLE', hits }
  },
  async lookupParcels(query) {
    const { longitude, latitude } = query.around
    const pad = 0.0002
    const queried = await queryJson(SUMMIT_PARCELS_URL, {
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'SITEADDRESS,PARCELID',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    }, query.signal)
    if (queried.health !== 'AVAILABLE') {
      return { health: queried.health, hits: [], reason: queried.reason ?? 'Summit parcels unavailable.' }
    }
    const wanted = [
      query.parsed.houseNumber,
      query.parsed.streetStem,
      query.parsed.streetTypeAbbrev,
    ].filter(Boolean).join(' ').toUpperCase()
    const hits: PrecisionHit[] = []
    for (const feature of queried.features) {
      const attributes = stripOwnerLikeFields(feature.attributes)
      const site = attrString(attributes, 'SITEADDRESS')?.toUpperCase() ?? ''
      const rings = feature.geometry?.rings ?? []
      if (rings.length !== 1) continue
      const ring = rings[0].map(pair => ({ longitude: pair[0], latitude: pair[1] }))
      if (site && wanted && !site.includes(String(query.parsed.houseNumber)) && !site.includes(wanted)) continue
      if (!site && !pointInRing(query.around, ring)) continue
      hits.push({
        providerId: 'summit_address_points',
        source: 'County of Summit GIS Tax Parcels',
        matchClass: 'PARCEL',
        longitude,
        latitude,
        houseNumber: query.parsed.houseNumber,
        preDirectional: query.parsed.preDirectional,
        streetName: query.parsed.streetName,
        streetTypeAbbrev: query.parsed.streetTypeAbbrev,
        postDirectional: query.parsed.postDirectional,
        unit: query.parsed.unit,
        city: query.parsed.city,
        state: query.parsed.stateProvince,
        postcode: query.parsed.postalCode,
        label: site || (query.parsed.name ?? 'Summit parcel'),
        geometryKind: 'polygon',
        ring,
        boundingBox: ringBounds(ring),
        providerPrecisionSignal: 'parcel_geometry',
        provenance: SUMMIT_PARCELS_URL,
      })
    }
    if (hits.length !== 1) {
      return { health: 'NO_DATA', hits: [], reason: 'Parcel geometry ambiguous or SITEADDRESS incomplete — address point stands.' }
    }
    return { health: 'AVAILABLE', hits }
  },
}

function ringBounds(ring: { longitude: number; latitude: number }[]) {
  return {
    west: Math.min(...ring.map(p => p.longitude)),
    east: Math.max(...ring.map(p => p.longitude)),
    south: Math.min(...ring.map(p => p.latitude)),
    north: Math.max(...ring.map(p => p.latitude)),
  }
}

function pointInRing(point: { longitude: number; latitude: number }, ring: { longitude: number; latitude: number }[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude
    const yi = ring[i].latitude
    const xj = ring[j].longitude
    const yj = ring[j].latitude
    const intersect = ((yi > point.latitude) !== (yj > point.latitude))
      && (point.longitude < ((xj - xi) * (point.latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function minDistanceMeters(point: { longitude: number; latitude: number }, ring: { longitude: number; latitude: number }[]): number {
  let min = Number.POSITIVE_INFINITY
  for (const vertex of ring) {
    const dLat = (vertex.latitude - point.latitude) * 111_320
    const dLon = (vertex.longitude - point.longitude) * 111_320 * Math.cos((point.latitude * Math.PI) / 180)
    min = Math.min(min, Math.hypot(dLat, dLon))
  }
  return min
}
