import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'celestrak' as const
const BASE_URL = 'https://celestrak.org/NORAD/elements/gp.php'
const NORAD_ID_PATTERN = /^\d{1,6}$/
const KNOWN_GROUPS = new Set(['stations', 'active', 'visual', 'weather', 'gps-ops', 'starlink'])
const DEFAULT_GROUP = 'stations'

type GpElement = { OBJECT_NAME?: string; OBJECT_ID?: string; NORAD_CAT_ID?: number; EPOCH?: string; MEAN_MOTION?: number; ECCENTRICITY?: number; INCLINATION?: number }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const url = new URL(BASE_URL)
  let cacheKey: string
  if (NORAD_ID_PATTERN.test(text)) {
    url.searchParams.set('CATNR', text)
    cacheKey = `celestrak:catnr:${text}`
  } else {
    const group = KNOWN_GROUPS.has(text.toLowerCase()) ? text.toLowerCase() : DEFAULT_GROUP
    url.searchParams.set('GROUP', group)
    cacheKey = `celestrak:group:${group}`
  }
  url.searchParams.set('FORMAT', 'json')

  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GpElement[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CelesTrak response was not a JSON array.' }
  }

  const limit = Math.max(1, Math.min(query.maxResults ?? 20, 50))
  const documents = data
    .filter(el => typeof el.NORAD_CAT_ID === 'number' && el.OBJECT_NAME)
    .slice(0, limit)
    .map(el => {
      const id = String(el.NORAD_CAT_ID)
      const canonicalUrl = `https://celestrak.org/satcat/table-satcat.php?NORAD_CAT_ID=${id}`
      return makeDocument({
        id: `celestrak:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: el.OBJECT_NAME as string,
        summary: el.OBJECT_ID ? `International designator: ${el.OBJECT_ID}` : null,
        contentSnippet: typeof el.INCLINATION === 'number' ? `Inclination: ${el.INCLINATION}°` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'CelesTrak',
        contentType: 'satellite_orbital_elements',
        authors: [],
        organization: null,
        publishedAt: el.EPOCH ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { norad_cat_id: id, ...(el.OBJECT_ID ? { international_designator: el.OBJECT_ID } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`CelesTrak fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?CATNR=25544&FORMAT=json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'gp.php reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const celestrakAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
