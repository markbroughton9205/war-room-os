import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'satnogs' as const
const BASE_URL = 'https://db.satnogs.org/api/satellites/'
const MAX_RESULTS = 25

type Satellite = { sat_id?: string; norad_cat_id?: number; name?: string; names?: string; status?: string; operator?: string; countries?: string; launched?: string; website?: string }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a satellite name or NORAD ID.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `satnogs:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('search', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Satellite[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SatNOGS DB response was not a JSON array.' }
  }

  const documents = data
    .slice(0, limit)
    .filter(s => typeof s.sat_id === 'string')
    .map(s => {
      const id = s.sat_id as string
      const canonicalUrl = `https://db.satnogs.org/satellite/${id}`
      return makeDocument({
        id: `satnogs:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: s.name ?? id,
        summary: s.names ?? null,
        contentSnippet: [s.status, s.operator].filter(Boolean).join(' — ') || null,
        canonicalUrl,
        sourceUrl: s.website || canonicalUrl,
        sourceName: 'SatNOGS DB',
        contentType: 'satellite_record',
        authors: [],
        organization: s.operator ?? null,
        publishedAt: s.launched ?? null,
        updatedAt: null,
        geography: s.countries ?? null,
        language: 'en',
        identifiers: { satnogs_sat_id: id, ...(s.norad_cat_id != null ? { norad_cat_id: String(s.norad_cat_id) } : {}) },
        subjects: s.status ? [s.status] : [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`SatNOGS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?search=ISS`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'satellites endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const satnogsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
