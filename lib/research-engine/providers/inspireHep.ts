import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'inspire_hep' as const
const BASE_URL = 'https://inspirehep.net/api/literature'
const MAX_RESULTS = 20
const FIELDS = 'titles,arxiv_eprints,earliest_date'

type InspireHit = { id?: string; metadata?: { titles?: { title?: string }[]; arxiv_eprints?: { value?: string }[]; earliest_date?: string } }
type InspireResponse = { hits?: { hits?: InspireHit[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `inspire_hep:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('size', String(limit))
  url.searchParams.set('fields', FIELDS)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<InspireResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.hits?.hits)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'INSPIRE-HEP response "hits.hits" field was missing or not an array.' }
  }

  const documents = data.hits!.hits!
    .filter(hit => hit.id && hit.metadata?.titles?.[0]?.title)
    .map(hit => {
      const id = hit.id as string
      const canonicalUrl = `https://inspirehep.net/literature/${id}`
      const arxivId = hit.metadata?.arxiv_eprints?.[0]?.value
      return makeDocument({
        id: `inspire_hep:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: hit.metadata!.titles![0].title as string,
        summary: null,
        contentSnippet: arxivId ? `arXiv: ${arxivId}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'INSPIRE-HEP',
        contentType: 'scholarly_work',
        authors: [],
        organization: null,
        publishedAt: hit.metadata?.earliest_date ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { inspire_id: id, ...(arxivId ? { arxiv_id: arxivId } : {}) },
        subjects: [],
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
      if (outcome.kind === 'http_error') throw new Error(`INSPIRE-HEP search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=title%20test&size=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'literature endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const inspireHepAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
