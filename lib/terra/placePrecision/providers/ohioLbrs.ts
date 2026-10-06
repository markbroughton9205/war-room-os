import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import { fetchTerraOfficialGis, sqlLiteral } from '../gisFetch'
import { stripOwnerLikeFields } from '../privacy'
import type { PrecisionHit, PrecisionLookupQuery, PrecisionLookupResult, PrecisionProvider } from './types'

export const OHIO_LBRS_URL =
  'https://maps.ohio.gov/arcgis/rest/services/Hosted/Ohio_Statewide_LBRS_Address_Points/FeatureServer/0/query'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const LBRS_FIELDS = 'ADD_NUMBER,HOUSENUM,ADDR_NUM,PREDIR,PRE_DIR,ST_NAME,STREETNAME,STR_NAME,ST_TYPE,STREETTYPE,STR_TYPE,SUFDIR,SUF_DIR,MUNICIPALITY,CITY,POSTAL_COMMUNITY,ZIP,ZIPCODE,STATE,COUNTY'

function isOhio(query: PrecisionLookupQuery): boolean {
  if (query.parsed.countryCode && query.parsed.countryCode !== 'US') return false
  if (query.parsed.stateProvince && /^(OH|Ohio)$/i.test(query.parsed.stateProvince)) return true
  const hint = query.hint
  if (!hint) return false
  return hint.longitude > -84.9 && hint.longitude < -80.5 && hint.latitude > 38.4 && hint.latitude < 42.0
}

function pick(attributes: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const direct = attributes[name]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct)
    const found = Object.entries(attributes).find(([key, value]) => key.toLowerCase() === name.toLowerCase() && value != null && String(value).trim())
    if (found) return String(found[1]).trim()
  }
  return null
}

function featureToHit(feature: { attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } }): PrecisionHit | null {
  const attributes = stripOwnerLikeFields(feature.attributes)
  const houseNumber = pick(attributes, ['ADD_NUMBER', 'HOUSENUM', 'ADDR_NUM', 'Add_Number'])
  const streetName = pick(attributes, ['ST_NAME', 'STREETNAME', 'STR_NAME', 'St_Name'])
  const streetType = pick(attributes, ['ST_TYPE', 'STREETTYPE', 'STR_TYPE', 'St_Type'])
  const longitude = Number(feature.geometry?.x)
  const latitude = Number(feature.geometry?.y)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !houseNumber || !streetName || !streetType) return null
  const city = pick(attributes, ['MUNICIPALITY', 'CITY', 'POSTAL_COMMUNITY'])
  const postcode = pick(attributes, ['ZIP', 'ZIPCODE', 'Zip'])
  const state = pick(attributes, ['STATE']) ?? 'OH'
  const pre = pick(attributes, ['PREDIR', 'PRE_DIR'])
  const post = pick(attributes, ['SUFDIR', 'SUF_DIR'])
  return {
    providerId: 'ohio_lbrs',
    source: 'Ohio LBRS Address Points',
    matchClass: 'ADDRESS_POINT',
    longitude,
    latitude,
    houseNumber,
    preDirectional: pre,
    streetName,
    streetTypeAbbrev: streetType.toUpperCase(),
    postDirectional: post,
    unit: pick(attributes, ['UNIT', 'UNITNUM']),
    city,
    state,
    postcode,
    label: [houseNumber, pre, streetName, streetType, post, city, state, postcode].filter(Boolean).join(' '),
    geometryKind: 'point',
    ring: null,
    boundingBox: null,
    providerPrecisionSignal: 'address_point',
    provenance: OHIO_LBRS_URL,
  }
}

function whereClause(query: PrecisionLookupQuery): string | null {
  const parsed = query.parsed
  if (!parsed.houseNumber || !parsed.streetStem || !parsed.streetTypeAbbrev) return null
  const house = /^\d+$/.test(parsed.houseNumber) ? parsed.houseNumber : sqlLiteral(parsed.houseNumber)
  const name = sqlLiteral(parsed.streetStem.toUpperCase())
  const type = sqlLiteral(parsed.streetTypeAbbrev.toUpperCase())
  return [
    `(ADD_NUMBER=${house} OR HOUSENUM=${house} OR ADDR_NUM=${house})`,
    `(UPPER(ST_NAME)=${name} OR UPPER(STREETNAME)=${name} OR UPPER(STR_NAME)=${name})`,
    `(UPPER(ST_TYPE)=${type} OR UPPER(STREETTYPE)=${type} OR UPPER(STR_TYPE)=${type})`,
  ].join(' AND ')
}

export const ohioLbrsProvider: PrecisionProvider = {
  id: 'ohio_lbrs',
  label: 'Ohio LBRS',
  pluginFlag: 'ohio_lbrs',
  supports(query) {
    return query.parsed.addressLike && isOhio(query)
  },
  async lookupAddressPoints(query) {
    const where = whereClause(query)
    if (!where) return { health: 'NO_DATA', hits: [], reason: 'Structured house/street/type required.' }
    const cacheKey = `terra-precision:ohio-lbrs:${where}`
    const cached = cacheGet<PrecisionLookupResult>(cacheKey)
    if (cached) return cached
    const url = new URL(OHIO_LBRS_URL)
    url.searchParams.set('where', where)
    url.searchParams.set('outFields', LBRS_FIELDS)
    url.searchParams.set('returnGeometry', 'true')
    url.searchParams.set('outSR', '4326')
    url.searchParams.set('f', 'json')
    const fetched = await fetchTerraOfficialGis({ service: 'ohio_lbrs', url: url.toString(), signal: query.signal, timeoutMs: 7_000 })
    if (!fetched.ok) {
      const health = fetched.status === 429 ? 'RATE_LIMITED' : fetched.status === 401 || fetched.status === 403 ? 'AUTH_REQUIRED' : 'UNAVAILABLE'
      return { health, hits: [], reason: fetched.text || `Ohio LBRS HTTP ${fetched.status}.` }
    }
    try {
      const payload = JSON.parse(fetched.text) as { features?: Array<{ attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } }>; error?: { message?: string } }
      if (payload.error?.message) return { health: 'UNAVAILABLE', hits: [], reason: payload.error.message }
      const hits = (payload.features ?? []).map(featureToHit).filter((row): row is PrecisionHit => row !== null)
      const result: PrecisionLookupResult = hits.length
        ? { health: 'AVAILABLE', hits }
        : { health: 'NO_DATA', hits: [], reason: 'Ohio LBRS returned no matching address point.' }
      cacheSet(cacheKey, result, CACHE_TTL_MS)
      return result
    } catch {
      return { health: 'UNAVAILABLE', hits: [], reason: 'Ohio LBRS returned malformed JSON.' }
    }
  },
}
