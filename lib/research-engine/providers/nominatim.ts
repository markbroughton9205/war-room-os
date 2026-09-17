import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nominatim' as const
const BASE_URL = 'https://nominatim.openstreetmap.org/search'
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
const MAX_RESULTS = 10

// Nominatim's usage policy is an absolute hard ceiling of 1 request/second,
// no burst allowance — enforced here, not just documented (same throttle
// pattern already used by the arxiv adapter).
const MIN_INTERVAL_MS = 1_100
const RATE_LIMIT_MAX_BACKOFF_MS = 60_000
let lastRequestAt = 0
let rateLimitedUntil = 0
let rateLimitStreak = 0

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt)
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}

function rateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now())
}

function noteNominatimSuccess(): void {
  rateLimitStreak = 0
  rateLimitedUntil = 0
}

function noteNominatimRateLimit(retryAfterMs?: number | null): number {
  rateLimitStreak += 1
  const exponential = Math.min(RATE_LIMIT_MAX_BACKOFF_MS, 2_000 * (2 ** Math.min(rateLimitStreak, 5)))
  const wait = Math.max(exponential, retryAfterMs ?? 0)
  rateLimitedUntil = Date.now() + wait
  return wait
}

export function nominatimBackoffRemainingMs(): number {
  return rateLimitRemainingMs()
}

export function __resetNominatimBackoffForTests(): void {
  lastRequestAt = 0
  rateLimitedUntil = 0
  rateLimitStreak = 0
}

import { TERRA_PUBLIC_USER_AGENT } from '@/lib/terra/terraPublicIdentity'

function userAgent(): string {
  return process.env.NOMINATIM_USER_AGENT_BASE?.trim() || TERRA_PUBLIC_USER_AGENT
}

type NominatimAddress = {
  amenity?: string
  building?: string
  house_number?: string
  road?: string
  neighbourhood?: string
  suburb?: string
  city_district?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  county?: string
  state?: string
  region?: string
  postcode?: string
  country?: string
  country_code?: string
}

type NominatimResult = {
  place_id?: number
  osm_type?: string
  osm_id?: number
  lat?: string
  lon?: string
  display_name?: string
  name?: string
  class?: string
  type?: string
  address?: NominatimAddress
  /** Nominatim's own result bounding box: [south, north, west, east] as strings. Present on every
   * /search result by default (no extra request param needed) — not present on /reverse. */
  namedetails?: Record<string, string>
  boundingbox?: [string, string, string, string]
}

export type NominatimReverseResult =
  | {
    ok: true
    label: string
    place: string | null
    address: string | null
    region: string | null
    latitude: number
    longitude: number
    sourceUrl: string | null
    category: string | null
    nativeName: string | null
    englishName: string | null
    city: string | null
    county: string | null
    state: string | null
    country: string | null
    countryCode: string | null
    locality: string | null
    neighbourhood: string | null
  }
  | { ok: false; reason: string }

const OSM_NATIVE_NAME_KEYS = ['name:ja', 'name:zh', 'name:zh-Hans', 'name:zh-Hant', 'name:ko', 'name:ar', 'name:uk', 'name:ru', 'name:hi', 'name:th', 'name:he', 'name:fa', 'name:el']

function nominatimNativeEnglish(namedetails?: Record<string, string> | null, fallback?: string | null): { nativeName: string | null; englishName: string | null } {
  const details = namedetails ?? {}
  const english = details['name:en']?.trim() || null
  const native = OSM_NATIVE_NAME_KEYS.map(key => details[key]?.trim()).find(Boolean)
    || details.name?.trim()
    || fallback?.trim()
    || null
  return { nativeName: native, englishName: english }
}

/** Reverse geocoding shares Nominatim's existing allowlist, throttle, cache, timeout, and user
 * agent boundary. Terra calls this server-side helper; clients never contact Nominatim directly. */
export async function reverseNominatimCoordinates(latitude: number, longitude: number): Promise<NominatimReverseResult> {
  const roundedLatitude = Number(latitude.toFixed(6))
  const roundedLongitude = Number(longitude.toFixed(6))
  const cacheKey = `nominatim:reverse:${roundedLatitude}:${roundedLongitude}`
  const cached = cacheGet<NominatimReverseResult>(cacheKey)
  if (cached) return cached
  const backoff = rateLimitRemainingMs()
  if (backoff > 0) {
    return { ok: false as const, reason: `Nominatim reverse lookup is backing off for ${Math.ceil(backoff / 1000)}s after HTTP 429.` }
  }

  try {
    return await withProviderGate(PROVIDER, async () => {
      const url = new URL(REVERSE_URL)
      url.searchParams.set('lat', String(roundedLatitude))
      url.searchParams.set('lon', String(roundedLongitude))
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('zoom', '18')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('namedetails', '1')

      await throttle()
      const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 10_000, maxRetries: 0 })
      if (!result.ok) {
        if (result.status === 429) {
          const wait = noteNominatimRateLimit(result.retryAfterMs)
          return { ok: false as const, reason: `Nominatim reverse lookup failed with HTTP 429. Backing off ${Math.ceil(wait / 1000)}s.` }
        }
        return { ok: false as const, reason: `Nominatim reverse lookup failed with HTTP ${result.status}.` }
      }

      const row = safeJsonParse<NominatimResult & { error?: string }>(result.text)
      const resolvedLatitude = Number(row?.lat)
      const resolvedLongitude = Number(row?.lon)
      if (!row || row.error || !row.display_name || !Number.isFinite(resolvedLatitude) || !Number.isFinite(resolvedLongitude)) {
        return { ok: false as const, reason: row?.error || 'Nominatim returned no supported place or address for these coordinates.' }
      }

      const stableId = row.osm_type && row.osm_id ? `${row.osm_type}/${row.osm_id}` : null
      const address = row.address
      const streetAddress = [address?.house_number, address?.road].filter(Boolean).join(' ') || null
      const rawCity = address?.city ?? address?.town ?? address?.village ?? address?.municipality ?? null
      const cityLooksNarrow = Boolean(rawCity && (/\b(township|ward)\b/i.test(rawCity) || /区$/.test(rawCity)))
      const city = cityLooksNarrow ? null : rawCity
      const locality = city ?? address?.city_district ?? address?.suburb ?? address?.neighbourhood ?? address?.county ?? rawCity ?? null
      const region = [address?.state ?? address?.region ?? address?.county, address?.country].filter(Boolean).join(', ') || null
      const names = nominatimNativeEnglish(row.namedetails, row.name ?? locality)
      const countryCode = address?.country_code ? address.country_code.toUpperCase() : null
      const resolution: NominatimReverseResult = {
        ok: true,
        label: names.nativeName && names.englishName && names.nativeName !== names.englishName
          ? `${names.nativeName} / ${names.englishName}`
          : row.display_name,
        place: names.nativeName && names.englishName && names.nativeName !== names.englishName
          ? `${names.nativeName} / ${names.englishName}`
          : (row.name ?? address?.amenity ?? address?.building ?? locality),
        address: [streetAddress, locality, address?.postcode].filter(Boolean).join(', ') || null,
        region,
        latitude: resolvedLatitude,
        longitude: resolvedLongitude,
        sourceUrl: stableId ? `https://www.openstreetmap.org/${stableId}` : null,
        category: row.class && row.type ? `${row.class}/${row.type}` : null,
        nativeName: names.nativeName,
        englishName: names.englishName,
        city,
        county: address?.county ?? null,
        state: address?.state ?? address?.region ?? null,
        country: address?.country ?? null,
        countryCode,
        locality: rawCity ?? address?.city_district ?? null,
        neighbourhood: address?.neighbourhood ?? address?.suburb ?? null,
      }
      noteNominatimSuccess()
      cacheSet(cacheKey, resolution, CACHE_TTL.webSearch)
      return resolution
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 5, MAX_RESULTS))
  const cacheKey = `nominatim:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }
  const backoff = rateLimitRemainingMs()
  if (backoff > 0) {
    return { ok: false as const, kind: 'http_error' as const, status: 429, message: `Nominatim search is backing off for ${Math.ceil(backoff / 1000)}s after HTTP 429.` }
  }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('namedetails', '1')
  url.searchParams.set('addressdetails', '1')

  await throttle()
  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 10_000, maxRetries: 0 })
  if (!result.ok) {
    if (result.status === 429) noteNominatimRateLimit(result.retryAfterMs)
    return { ok: false as const, kind: 'http_error' as const, status: result.status }
  }

  const data = safeJsonParse<NominatimResult[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Nominatim response was not a JSON array.' }
  }

  const documents = data
    .filter(row => row.place_id && row.display_name)
    .map(row => {
      const stableId = row.osm_type && row.osm_id ? `${row.osm_type}:${row.osm_id}` : String(row.place_id)
      const canonicalUrl = row.osm_type && row.osm_id ? `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}` : null
      // God's Eye multi-scale phase: carried through `identifiers` (the same string-bag field
      // normalizeLatentGeoDocument.ts already reads for opensky/met_no-style extra structured
      // data) rather than widening ResearchDocument's shape — lib/terra/resolveGeography.ts reads
      // these back out for search-driven camera framing; every other Nominatim caller ignores them.
      const identifiers: Record<string, string> = { place_id: String(row.place_id) }
      if (row.class) identifiers.class = row.class
      if (row.type) identifiers.type = row.type
      const names = nominatimNativeEnglish(row.namedetails, row.name ?? row.display_name)
      if (names.nativeName) identifiers.name_native = names.nativeName
      if (names.englishName) identifiers.name_en = names.englishName
      if (Array.isArray(row.boundingbox) && row.boundingbox.length === 4) {
        const [south, north, west, east] = row.boundingbox
        identifiers.bbox_south = south
        identifiers.bbox_north = north
        identifiers.bbox_west = west
        identifiers.bbox_east = east
      }
      return makeDocument({
        id: `nominatim:${stableId}`,
        provider: PROVIDER,
        providerRecordId: stableId,
        title: row.display_name as string,
        summary: row.class && row.type ? `${row.class}/${row.type}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OpenStreetMap Nominatim',
        contentType: 'geocoding_result',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: row.lat && row.lon ? `lat ${row.lat}, lon ${row.lon}` : null,
        language: null,
        identifiers,
        subjects: [],
        license: 'ODbL',
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  noteNominatimSuccess()
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        const message = 'message' in outcome && outcome.message
          ? outcome.message
          : `Nominatim search failed with HTTP ${outcome.status}`
        const error = new Error(message) as Error & { httpStatus?: number }
        error.httpStatus = outcome.status
        throw error
      }
      throw new Error(outcome.message)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const httpStatus = error && typeof error === 'object' && 'httpStatus' in error && typeof error.httpStatus === 'number'
      ? error.httpStatus
      : /HTTP 429/.test(message) ? 429 : null
    return errorResponse(PROVIDER, {
      provider: PROVIDER,
      category: httpStatus === 429 || /HTTP 429|backing off/.test(message) ? 'rate_limited' : 'upstream_error',
      message,
      httpStatus,
    }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    await throttle()
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=Paris&format=json&limit=1`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000, maxRetries: 0 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nominatimAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
