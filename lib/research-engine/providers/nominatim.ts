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
let lastRequestAt = 0

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt)
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}

function userAgent(): string {
  return process.env.NOMINATIM_USER_AGENT_BASE?.trim() || 'WarRoomResearchEngine/1.0 (github.com/war-room-os)'
}

type NominatimAddress = {
  amenity?: string
  building?: string
  house_number?: string
  road?: string
  neighbourhood?: string
  suburb?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  county?: string
  state?: string
  region?: string
  postcode?: string
  country?: string
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
  boundingbox?: [string, string, string, string]
}

export type NominatimReverseResult =
  | { ok: true; label: string; place: string | null; address: string | null; region: string | null; latitude: number; longitude: number; sourceUrl: string | null; category: string | null }
  | { ok: false; reason: string }

/** Reverse geocoding shares Nominatim's existing allowlist, throttle, cache, timeout, and user
 * agent boundary. Terra calls this server-side helper; clients never contact Nominatim directly. */
export async function reverseNominatimCoordinates(latitude: number, longitude: number): Promise<NominatimReverseResult> {
  const roundedLatitude = Number(latitude.toFixed(6))
  const roundedLongitude = Number(longitude.toFixed(6))
  const cacheKey = `nominatim:reverse:${roundedLatitude}:${roundedLongitude}`
  const cached = cacheGet<NominatimReverseResult>(cacheKey)
  if (cached) return cached

  try {
    return await withProviderGate(PROVIDER, async () => {
      const url = new URL(REVERSE_URL)
      url.searchParams.set('lat', String(roundedLatitude))
      url.searchParams.set('lon', String(roundedLongitude))
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('zoom', '18')
      url.searchParams.set('addressdetails', '1')

      await throttle()
      const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 10_000 })
      if (!result.ok) return { ok: false as const, reason: `Nominatim reverse lookup failed with HTTP ${result.status}.` }

      const row = safeJsonParse<NominatimResult & { error?: string }>(result.text)
      const resolvedLatitude = Number(row?.lat)
      const resolvedLongitude = Number(row?.lon)
      if (!row || row.error || !row.display_name || !Number.isFinite(resolvedLatitude) || !Number.isFinite(resolvedLongitude)) {
        return { ok: false as const, reason: row?.error || 'Nominatim returned no supported place or address for these coordinates.' }
      }

      const stableId = row.osm_type && row.osm_id ? `${row.osm_type}/${row.osm_id}` : null
      const address = row.address
      const streetAddress = [address?.house_number, address?.road].filter(Boolean).join(' ') || null
      const locality = address?.city ?? address?.town ?? address?.village ?? address?.municipality ?? address?.suburb ?? address?.neighbourhood ?? address?.county ?? null
      const region = [address?.state ?? address?.region ?? address?.county, address?.country].filter(Boolean).join(', ') || null
      const resolution: NominatimReverseResult = {
        ok: true,
        label: row.display_name,
        place: row.name ?? address?.amenity ?? address?.building ?? locality,
        address: [streetAddress, locality, address?.postcode].filter(Boolean).join(', ') || null,
        region,
        latitude: resolvedLatitude,
        longitude: resolvedLongitude,
        sourceUrl: stableId ? `https://www.openstreetmap.org/${stableId}` : null,
        category: row.class && row.type ? `${row.class}/${row.type}` : null,
      }
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

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))

  await throttle()
  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

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
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Nominatim search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    await throttle()
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=Paris&format=json&limit=1`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nominatimAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
