import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'mushroom_observer' as const
const BASE_URL = 'https://mushroomobserver.org/api2/observations'
const MAX_RESULTS = 25

type ConsensusName = { name?: string }
type Observation = { id?: number; date?: string; confidence?: number; consensus?: ConsensusName; notes?: string }
type SearchResponse = { results?: Observation[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a species/taxon name (e.g. "Amanita muscaria").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `mushroom_observer:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('name', text)
  url.searchParams.set('format', 'json')
  // Without detail=high, "results" is just bare numeric IDs (confirmed live)
  // — full records require this param, not a second per-record fetch.
  url.searchParams.set('detail', 'high')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Mushroom Observer response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .slice(0, limit)
    .filter(o => o.id != null)
    .map(o => {
      const id = String(o.id)
      const canonicalUrl = `https://mushroomobserver.org/${id}`
      return makeDocument({
        id: `mushroom_observer:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: o.consensus?.name ?? `Observation ${id}`,
        summary: o.notes ?? null,
        contentSnippet: typeof o.confidence === 'number' ? `Confidence: ${o.confidence}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Mushroom Observer',
        contentType: 'species_observation',
        authors: [],
        organization: null,
        publishedAt: o.date ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { mushroom_observer_id: id },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Mushroom Observer search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?name=Amanita+muscaria&format=json&detail=high`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'observations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const mushroomObserverAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
