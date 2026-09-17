/**
 * Geographic relevance for Live Intel LOCAL.
 * Does not geolocate an article from publisher headquarters.
 * Same-country is never treated as nearby.
 */
import type { GodsEyeZoomRung } from './godsEye/zoomLadder'
import {
  haversineKm,
  isDeviceOnlyPlaceLabel,
  pointInRectangle,
  significantPlaceTokens,
  type TerraGeographicContext,
} from './geographicContext'

export const TERRA_GEO_RELATIONS = [
  'WITHIN_VIEWPORT',
  'NEAR_ACTIVE_POINT',
  'SAME_CITY',
  'SAME_COUNTY_DISTRICT',
  'SAME_STATE_PROVINCE',
  'SAME_COUNTRY',
  'OUTSIDE_SCOPE',
  'LOCATION_UNKNOWN',
] as const
export type TerraGeoRelation = (typeof TERRA_GEO_RELATIONS)[number]

export const TERRA_RADIUS_TIERS = ['IMMEDIATE', 'NEARBY', 'METRO', 'REGIONAL'] as const
export type TerraRadiusTier = (typeof TERRA_RADIUS_TIERS)[number]

export type TerraLocalIntelCandidate = {
  originalHeadline: string
  originalSummary?: string | null
  headline?: string | null
  summary?: string | null
  location?: string | null
  nativeLocationName?: string | null
  englishLocationName?: string | null
  lat: number | null
  lon: number | null
  source: string
  provider: string
}

export type TerraLocalRelevance = {
  relation: TerraGeoRelation
  distanceKm: number | null
  radiusTier: TerraRadiusTier | null
  matchedToken: string | null
  includeInLocal: boolean
}

export type TerraLocalRadiusPolicy = {
  immediateKm: number
  nearbyKm: number
  metroKm: number
  regionalKm: number
}

export function localRadiusPolicy(zoom: GodsEyeZoomRung): TerraLocalRadiusPolicy {
  if (zoom === 'STREET' || zoom === 'FEATURE') {
    return { immediateKm: 8, nearbyKm: 25, metroKm: 60, regionalKm: 80 }
  }
  if (zoom === 'NEIGHBORHOOD') {
    return { immediateKm: 15, nearbyKm: 40, metroKm: 80, regionalKm: 120 }
  }
  if (zoom === 'CITY') {
    return { immediateKm: 25, nearbyKm: 80, metroKm: 160, regionalKm: 250 }
  }
  if (zoom === 'COUNTRY') {
    return { immediateKm: 80, nearbyKm: 250, metroKm: 500, regionalKm: 900 }
  }
  return { immediateKm: 0, nearbyKm: 0, metroKm: 0, regionalKm: 0 }
}

export function radiusTierForDistanceKm(distanceKm: number, policy: TerraLocalRadiusPolicy): TerraRadiusTier | null {
  if (distanceKm <= policy.immediateKm) return 'IMMEDIATE'
  if (distanceKm <= policy.nearbyKm) return 'NEARBY'
  if (distanceKm <= policy.metroKm) return 'METRO'
  if (distanceKm <= policy.regionalKm) return 'REGIONAL'
  return null
}

function normalizeName(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed || null
}

function textBlob(item: TerraLocalIntelCandidate): string {
  return [
    item.originalHeadline,
    item.originalSummary,
    item.headline,
    item.summary,
    item.location,
    item.nativeLocationName,
    item.englishLocationName,
  ].filter(Boolean).join(' ').toLowerCase()
}

function containsName(haystack: string, name: string | null | undefined): boolean {
  const needle = normalizeName(name)
  if (!needle || needle.length < 3) return false
  return haystack.includes(needle)
}

function publisherLooksLikePlace(item: Pick<TerraLocalIntelCandidate, 'source' | 'provider'>, name: string | null | undefined): boolean {
  const needle = normalizeName(name)
  if (!needle) return false
  return `${item.source} ${item.provider}`.toLowerCase().includes(needle)
}

export function localNewsSearchQuery(context: Pick<TerraGeographicContext, 'city' | 'county' | 'state' | 'country' | 'placeName' | 'zoomLevel'>): string | null {
  if (context.zoomLevel === 'PLANET') return null
  if (context.zoomLevel === 'COUNTRY') {
    const regional = [context.state, context.country].filter(part => part && !isDeviceOnlyPlaceLabel(part))
    if (regional.length) return regional.join(' ')
  }
  const parts = [context.city, context.state || context.county]
    .filter((part): part is string => Boolean(part && !isDeviceOnlyPlaceLabel(part)))
  if (parts.length) return [...new Set(parts)].join(' ')
  if (context.placeName && !isDeviceOnlyPlaceLabel(context.placeName)) {
    return context.placeName.split(',').slice(0, 2).join(',').trim()
  }
  return null
}

function unknownRelevance(): TerraLocalRelevance {
  return {
    relation: 'LOCATION_UNKNOWN',
    distanceKm: null,
    radiusTier: null,
    matchedToken: null,
    includeInLocal: false,
  }
}

export function scoreLocalIntelItem(
  item: TerraLocalIntelCandidate,
  context: TerraGeographicContext,
): TerraLocalRelevance {
  if (context.zoomLevel === 'PLANET') return unknownRelevance()

  const policy = localRadiusPolicy(context.zoomLevel)
  const haystack = textBlob(item)

  if (item.lat !== null && item.lon !== null) {
    const distanceKm = haversineKm(context.lat, context.lon, item.lat, item.lon)
    const inView = pointInRectangle(item.lat, item.lon, context.bbox)
    const tier = radiusTierForDistanceKm(distanceKm, policy)
    if (inView) {
      return {
        relation: 'WITHIN_VIEWPORT',
        distanceKm,
        radiusTier: tier ?? 'REGIONAL',
        matchedToken: null,
        includeInLocal: true,
      }
    }
    if (tier) {
      return {
        relation: 'NEAR_ACTIVE_POINT',
        distanceKm,
        radiusTier: tier,
        matchedToken: null,
        includeInLocal: true,
      }
    }
    return {
      relation: 'OUTSIDE_SCOPE',
      distanceKm,
      radiusTier: null,
      matchedToken: null,
      includeInLocal: false,
    }
  }

  const city = normalizeName(context.city)
  const county = normalizeName(context.county)
  const state = normalizeName(context.state)
  const native = normalizeName(context.nativePlaceName)
  const allowState = context.zoomLevel === 'COUNTRY'

  if (city && containsName(haystack, context.city) && !publisherLooksLikePlace(item, context.city)) {
    return { relation: 'SAME_CITY', distanceKm: null, radiusTier: 'METRO', matchedToken: city, includeInLocal: true }
  }
  if (native && native !== city && containsName(haystack, context.nativePlaceName) && !publisherLooksLikePlace(item, context.nativePlaceName)) {
    return { relation: 'SAME_CITY', distanceKm: null, radiusTier: 'METRO', matchedToken: native, includeInLocal: true }
  }
  if (county && containsName(haystack, context.county) && !publisherLooksLikePlace(item, context.county)) {
    return { relation: 'SAME_COUNTY_DISTRICT', distanceKm: null, radiusTier: 'METRO', matchedToken: county, includeInLocal: true }
  }
  if (allowState && state && containsName(haystack, context.state) && !publisherLooksLikePlace(item, context.state)) {
    return { relation: 'SAME_STATE_PROVINCE', distanceKm: null, radiusTier: 'REGIONAL', matchedToken: state, includeInLocal: true }
  }

  const namedTokens = significantPlaceTokens([
    context.city,
    context.county,
    context.nativePlaceName,
    allowState ? context.state : null,
  ].filter(Boolean).join(' '))
  const hit = namedTokens.find(token => haystack.includes(token) && !publisherLooksLikePlace(item, token))
  if (hit) {
    const relation = hit === city ? 'SAME_CITY' : hit === county ? 'SAME_COUNTY_DISTRICT' : hit === state ? 'SAME_STATE_PROVINCE' : 'SAME_CITY'
    return {
      relation,
      distanceKm: null,
      radiusTier: relation === 'SAME_STATE_PROVINCE' ? 'REGIONAL' : 'METRO',
      matchedToken: hit,
      includeInLocal: true,
    }
  }

  return unknownRelevance()
}

export function localSectionDisplayCount(
  coverageState: string,
  count: number,
  areaCoverage?: string | null,
): string {
  if (coverageState === 'NO_COVERAGE' || areaCoverage === 'NO_COVERAGE') return 'NO_COVERAGE'
  if (coverageState === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (coverageState === 'AUTH_REQUIRED') return 'AUTH_REQUIRED'
  if (count > 0) return String(count)
  if (areaCoverage === 'RICH_COVERAGE') return 'RICH_COVERAGE'
  if (areaCoverage === 'SPARSE') return 'SPARSE'
  if (areaCoverage === 'PARTIAL' || coverageState === 'PARTIAL') return 'PARTIAL'
  if (coverageState === 'LIVE' || coverageState === 'STALE') return coverageState
  return coverageState || 'SPARSE'
}
