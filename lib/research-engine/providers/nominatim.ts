import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nominatim' as const
const BASE_URL = 'https://nominatim.openstreetmap.org/search'
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

type NominatimResult = { place_id?: number; osm_type?: string; osm_id?: number; lat?: string; lon?: string; display_name?: string; name?: string; class?: string; type?: string }

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
        identifiers: { place_id: String(row.place_id) },
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
