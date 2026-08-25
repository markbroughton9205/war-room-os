import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'dbpedia' as const
const BASE_URL = 'https://lookup.dbpedia.org/api/search'
const MAX_RESULTS = 25

type Doc = { resource?: string[]; label?: string[]; comment?: string[]; typeName?: string[] }
type SearchResponse = { docs?: Doc[] }

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `dbpedia:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('query', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('maxResults', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'DBpedia Lookup response "docs" field was missing or not an array.' }
  }

  const documents = data.docs
    .filter(doc => typeof doc.resource?.[0] === 'string')
    .map(doc => {
      const uri = doc.resource?.[0] as string
      const label = doc.label?.[0] ? stripHtml(doc.label[0]) : uri
      return makeDocument({
        id: `dbpedia:${uri}`,
        provider: PROVIDER,
        providerRecordId: uri,
        title: label,
        summary: doc.comment?.[0] ? stripHtml(doc.comment[0]) : null,
        contentSnippet: doc.typeName?.length ? `Types: ${doc.typeName.join(', ')}` : null,
        canonicalUrl: uri,
        sourceUrl: uri,
        sourceName: 'DBpedia',
        contentType: 'knowledge_graph_entity',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { dbpedia_uri: uri },
        subjects: doc.typeName ?? [],
        license: 'CC-BY-SA',
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
      if (outcome.kind === 'http_error') throw new Error(`DBpedia Lookup search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?query=Berlin&format=json&maxResults=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'lookup endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const dbpediaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
