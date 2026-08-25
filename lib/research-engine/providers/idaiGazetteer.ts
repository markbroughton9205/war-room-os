import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'idai_gazetteer' as const
const BASE_URL = 'https://gazetteer.dainst.org'
const MAX_RESULTS = 25

type PrefName = { title?: string; language?: string }
type PrefLocation = { coordinates?: [number, number] }
type Result = {
  '@id'?: string
  gazId?: string | number
  types?: string[]
  prefName?: PrefName
  prefLocation?: PrefLocation
}
type SearchResponse = { total?: number; result?: Result[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `idai_gazetteer:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search.json`)
  url.searchParams.set('q', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.result)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'iDAI.gazetteer response "result" field was missing or not an array.' }
  }

  const documents = data.result
    .slice(0, limit)
    .filter(r => r.gazId != null)
    .map(r => {
      const id = String(r.gazId)
      const canonicalUrl = r['@id'] ?? `https://gazetteer.dainst.org/place/${id}`
      const coords = r.prefLocation?.coordinates
      return makeDocument({
        id: `idai_gazetteer:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: r.prefName?.title ?? `Place ${id}`,
        summary: r.types?.length ? `Type: ${r.types.join(', ')}` : null,
        contentSnippet: coords ? `lat ${coords[1]}, lon ${coords[0]}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'iDAI.gazetteer',
        contentType: 'historical_place',
        authors: [],
        organization: 'German Archaeological Institute',
        publishedAt: null,
        updatedAt: null,
        geography: coords ? `lat ${coords[1]}, lon ${coords[0]}` : null,
        language: r.prefName?.language ?? null,
        identifiers: { idai_gaz_id: id },
        subjects: r.types ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`iDAI.gazetteer search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search.json?q=Pergamon`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const idaiGazetteerAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
