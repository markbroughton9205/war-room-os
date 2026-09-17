import 'server-only'

/**
 * Bounded place-search policy for Terra.
 * CACHE (Nominatim TTL cache) → primary Nominatim → configured/public fallback → explicit error.
 * Never fabricates a coordinate. Never used to obtain live GPS.
 */
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { isProviderEnvSatisfied, providerEnvDescriptor } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { resolvePlaceNameViaNominatim } from '@/lib/terra/resolveGeography'
import { looksLikePostalCode } from '@/lib/terra/locationCommand'
import { TERRA_PUBLIC_USER_AGENT } from '@/lib/terra/terraPublicIdentity'
import type { TerraResolvedGeography } from '@/lib/terra/types'

const FALLBACK_CACHE_TTL_MS = CACHE_TTL.webSearch
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const GEONAMES_SEARCH_URL = 'https://secure.geonames.org/searchJSON'

export function isTransientGeocoderFailure(reason: string | null | undefined): boolean {
  if (!reason) return false
  return /HTTP 429|rate[_ ]limit|cooldown|timed out|timeout|HTTP 5\d\d|unavailable|did not respond/i.test(reason)
}

export function configuredFallbackGeocoder(): 'open_meteo' | 'geonames' | 'none' {
  const configured = process.env.TERRA_FALLBACK_GEOCODER?.trim().toLowerCase()
  if (configured === 'none' || configured === 'off') return 'none'
  if (configured === 'geonames') return 'geonames'
  return 'open_meteo'
}

type OpenMeteoGeocodeRow = {
  id?: number
  name?: string
  latitude?: number
  longitude?: number
  country?: string
  country_code?: string
  admin1?: string
  admin2?: string
}

type GeonamesRow = {
  geonameId?: number
  name?: string
  toponymName?: string
  lat?: string
  lng?: string
  countryName?: string
  countryCode?: string
  adminName1?: string
}

function finiteCoord(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180
}

function unresolved(input: {
  provider: TerraResolvedGeography['resolverProviderId']
  sourceEntityId: string
  queryUsed: string
  retrievedAt: string
  reason: string
}): TerraResolvedGeography {
  return {
    quality: 'unresolved',
    resolverProviderId: input.provider,
    sourceEntityId: input.sourceEntityId,
    queryUsed: input.queryUsed,
    retrievedAt: input.retrievedAt,
    reason: input.reason,
  }
}

async function resolveViaOpenMeteo(queryUsed: string, sourceEntityId: string, retrievedAt: string): Promise<TerraResolvedGeography> {
  const cacheKey = `terra-geocode:open-meteo:${queryUsed.toLowerCase()}`
  const cached = cacheGet<TerraResolvedGeography>(cacheKey)
  if (cached) return cached
  const url = new URL(OPEN_METEO_GEOCODE_URL)
  url.searchParams.set('name', queryUsed)
  url.searchParams.set('count', looksLikePostalCode(queryUsed) ? '5' : '3')
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')
  const result = await safeProviderFetch('open_meteo', url.toString(), {
    headers: { 'User-Agent': TERRA_PUBLIC_USER_AGENT },
    timeoutMs: 8_000,
    maxRetries: 0,
  })
  if (!result.ok) {
    return unresolved({
      provider: 'open_meteo',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: `Fallback geocoder Open-Meteo failed with HTTP ${result.status}.`,
    })
  }
  const payload = safeJsonParse<{ results?: OpenMeteoGeocodeRow[] }>(result.text)
  const matches = (payload?.results ?? [])
    .map(row => {
      const latitude = Number(row.latitude)
      const longitude = Number(row.longitude)
      if (!finiteCoord(latitude, longitude) || !row.name) return null
      const label = [row.name, row.admin1, row.country].filter(Boolean).join(', ')
      return {
        latitude,
        longitude,
        label,
        placeType: null,
        boundingBox: null,
        nativeName: row.name,
        englishName: row.name,
        sourceUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}`,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
  if (matches.length === 0) {
    return unresolved({
      provider: 'open_meteo',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: 'Fallback geocoder Open-Meteo returned no coordinate-bearing match.',
    })
  }
  if (matches.length > 1) {
    const resolution: TerraResolvedGeography = {
      quality: 'ambiguous',
      resolverProviderId: 'open_meteo',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: `Fallback geocoder returned ${matches.length} distinct candidates — never auto-selecting one.`,
      matches,
    }
    cacheSet(cacheKey, resolution, FALLBACK_CACHE_TTL_MS)
    return resolution
  }
  const match = matches[0]
  const resolution: TerraResolvedGeography = {
    quality: 'strong',
    longitude: match.longitude,
    latitude: match.latitude,
    altitude: null,
    resolutionMethod: 'place_name_lookup',
    resolverProviderId: 'open_meteo',
    sourceEntityId,
    queryUsed,
    matchTitle: match.label,
    sourceUrl: match.sourceUrl,
    retrievedAt,
    placeType: null,
    boundingBox: null,
    nativeName: match.nativeName,
    englishName: match.englishName,
  }
  cacheSet(cacheKey, resolution, FALLBACK_CACHE_TTL_MS)
  return resolution
}

async function resolveViaGeonames(queryUsed: string, sourceEntityId: string, retrievedAt: string): Promise<TerraResolvedGeography> {
  const descriptor = providerEnvDescriptor('geonames')
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return unresolved({
      provider: 'geonames',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: 'GeoNames fallback is not configured (GEONAMES_USERNAME).',
    })
  }
  const cacheKey = `terra-geocode:geonames:${queryUsed.toLowerCase()}`
  const cached = cacheGet<TerraResolvedGeography>(cacheKey)
  if (cached) return cached
  const url = new URL(GEONAMES_SEARCH_URL)
  url.searchParams.set('q', queryUsed)
  url.searchParams.set('maxRows', '3')
  url.searchParams.set('username', process.env.GEONAMES_USERNAME?.trim() ?? '')
  const result = await safeProviderFetch('geonames', url.toString(), { timeoutMs: 10_000, maxRetries: 0 })
  if (!result.ok) {
    return unresolved({
      provider: 'geonames',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: `Fallback geocoder GeoNames failed with HTTP ${result.status}.`,
    })
  }
  const payload = safeJsonParse<{ geonames?: GeonamesRow[]; status?: { message?: string } }>(result.text)
  if (payload?.status?.message) {
    return unresolved({
      provider: 'geonames',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: `GeoNames API error: ${payload.status.message}`,
    })
  }
  const matches = (payload?.geonames ?? [])
    .map(row => {
      const latitude = Number(row.lat)
      const longitude = Number(row.lng)
      if (!finiteCoord(latitude, longitude)) return null
      const label = [row.name ?? row.toponymName, row.adminName1, row.countryName].filter(Boolean).join(', ')
      if (!label) return null
      return {
        latitude,
        longitude,
        label,
        placeType: null,
        boundingBox: null,
        nativeName: row.name ?? row.toponymName ?? null,
        englishName: row.name ?? row.toponymName ?? null,
        sourceUrl: row.geonameId ? `https://www.geonames.org/${row.geonameId}` : null,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
  if (matches.length === 0) {
    return unresolved({
      provider: 'geonames',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: 'Fallback geocoder GeoNames returned no coordinate-bearing match.',
    })
  }
  if (matches.length > 1) {
    const resolution: TerraResolvedGeography = {
      quality: 'ambiguous',
      resolverProviderId: 'geonames',
      sourceEntityId,
      queryUsed,
      retrievedAt,
      reason: `Fallback geocoder returned ${matches.length} distinct candidates — never auto-selecting one.`,
      matches,
    }
    cacheSet(cacheKey, resolution, FALLBACK_CACHE_TTL_MS)
    return resolution
  }
  const match = matches[0]
  const resolution: TerraResolvedGeography = {
    quality: 'strong',
    longitude: match.longitude,
    latitude: match.latitude,
    altitude: null,
    resolutionMethod: 'place_name_lookup',
    resolverProviderId: 'geonames',
    sourceEntityId,
    queryUsed,
    matchTitle: match.label,
    sourceUrl: match.sourceUrl,
    retrievedAt,
    placeType: null,
    boundingBox: null,
    nativeName: match.nativeName,
    englishName: match.englishName,
  }
  cacheSet(cacheKey, resolution, FALLBACK_CACHE_TTL_MS)
  return resolution
}

export async function resolveCommanderPlaceSearch(placeName: string, sourceEntityId: string): Promise<TerraResolvedGeography> {
  const primary = await resolvePlaceNameViaNominatim(placeName, sourceEntityId)
  if (primary.quality === 'strong' || primary.quality === 'exact' || primary.quality === 'ambiguous') {
    return primary
  }
  const reason = primary.quality === 'unresolved' ? primary.reason : 'Location could not be resolved.'
  if (!isTransientGeocoderFailure(reason)) return primary

  const fallback = configuredFallbackGeocoder()
  if (fallback === 'none') {
    return unresolved({
      provider: 'nominatim',
      sourceEntityId,
      queryUsed: placeName.trim(),
      retrievedAt: primary.retrievedAt,
      reason: `${reason} Fallback geocoder is disabled.`,
    })
  }

  if (fallback === 'geonames') {
    const geonames = await resolveViaGeonames(placeName.trim(), sourceEntityId, primary.retrievedAt)
    if (geonames.quality !== 'unresolved') return geonames
    return unresolved({
      provider: 'nominatim',
      sourceEntityId,
      queryUsed: placeName.trim(),
      retrievedAt: primary.retrievedAt,
      reason: `${reason} ${geonames.quality === 'unresolved' ? geonames.reason : ''}`.trim(),
    })
  }

  const openMeteo = await resolveViaOpenMeteo(placeName.trim(), sourceEntityId, primary.retrievedAt)
  if (openMeteo.quality !== 'unresolved') return openMeteo
  const geonamesConfigured = providerEnvDescriptor('geonames')
  if (geonamesConfigured && isProviderEnvSatisfied(geonamesConfigured)) {
    const geonames = await resolveViaGeonames(placeName.trim(), sourceEntityId, primary.retrievedAt)
    if (geonames.quality !== 'unresolved') return geonames
    return unresolved({
      provider: 'nominatim',
      sourceEntityId,
      queryUsed: placeName.trim(),
      retrievedAt: primary.retrievedAt,
      reason: `${reason} ${openMeteo.reason} ${geonames.quality === 'unresolved' ? geonames.reason : ''}`.trim(),
    })
  }
  return unresolved({
    provider: 'nominatim',
    sourceEntityId,
    queryUsed: placeName.trim(),
    retrievedAt: primary.retrievedAt,
    reason: `${reason} ${openMeteo.reason}`.trim(),
  })
}
