import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'kramerius' as const
const BASE_URL = 'https://kramerius5.nkp.cz/search/api/v5.0/search'
const MAX_RESULTS = 25

type Doc = { PID?: string; 'dc.title'?: string; 'dc.creator'?: string[]; datum_str?: string; language?: string[]; 'document_type'?: string[]; dostupnost?: string }
type SearchResponse = { response?: { docs?: Doc[]; numFound?: number } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150).replace(/["\\]/g, '')
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `kramerius:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', `dc.title:${text}`)
  url.searchParams.set('rows', String(limit))
  url.searchParams.set('wt', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const docs = data?.response?.docs
  if (!Array.isArray(docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Kramerius response "response.docs" field was missing or not an array.' }
  }

  const documents = docs
    .filter(d => typeof d.PID === 'string')
    .map(d => {
      const pid = d.PID as string
      const canonicalUrl = `https://kramerius5.nkp.cz/uuid/${encodeURIComponent(pid.replace(/^uuid:/, ''))}`
      return makeDocument({
        id: `kramerius:${pid}`,
        provider: PROVIDER,
        providerRecordId: pid,
        title: d['dc.title'] ?? pid,
        summary: null,
        contentSnippet: d.document_type?.length ? `Type: ${d.document_type.join(', ')}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Kramerius (National Library of the Czech Republic)',
        contentType: 'digitized_document',
        authors: d['dc.creator'] ?? [],
        organization: 'National Library of the Czech Republic',
        publishedAt: d.datum_str ?? null,
        updatedAt: null,
        geography: 'CZ',
        language: d.language?.[0] ?? 'cs',
        identifiers: { kramerius_pid: pid },
        subjects: [],
        license: d.dostupnost === 'public' ? 'public' : null,
        accessStatus: d.dostupnost === 'public' ? 'open' : 'restricted',
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
      if (outcome.kind === 'http_error') throw new Error(`Kramerius search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=dc.title:praha&rows=1&wt=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const krameriusAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
