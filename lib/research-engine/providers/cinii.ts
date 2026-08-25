import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cinii' as const
const BASE_URL = 'https://cir.nii.ac.jp/opensearch/articles'
const MAX_RESULTS = 25

type Item = { '@id'?: string; title?: string; 'dc:creator'?: string[]; 'prism:publicationName'?: string; 'prism:publicationDate'?: string }
type SearchResponse = { items?: Item[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `cinii:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('count', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CiNii response "items" field was missing or not an array.' }
  }

  const documents = data.items
    .filter(item => typeof item['@id'] === 'string')
    .map(item => {
      const id = item['@id'] as string
      return makeDocument({
        id: `cinii:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: item.title ?? id,
        summary: item['prism:publicationName'] ?? null,
        contentSnippet: null,
        canonicalUrl: id,
        sourceUrl: id,
        sourceName: 'CiNii Research',
        contentType: 'journal_article',
        authors: item['dc:creator'] ?? [],
        organization: 'National Institute of Informatics (Japan)',
        publishedAt: item['prism:publicationDate'] ?? null,
        updatedAt: null,
        geography: 'Japan',
        language: 'ja',
        identifiers: { cinii_crid: id },
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
      if (outcome.kind === 'http_error') throw new Error(`CiNii search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=science&format=json&count=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'opensearch endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ciniiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
