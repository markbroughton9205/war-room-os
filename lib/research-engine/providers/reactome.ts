import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'reactome' as const
const BASE_URL = 'https://reactome.org/ContentService/search/query'
const MAX_RESULTS = 25

type Entry = { dbId?: number | string; stId?: string; name?: string; type?: string; summation?: string }
type ResultGroup = { entries?: Entry[] }
type SearchResponse = { results?: ResultGroup[] }

function stripHighlight(input: string): string {
  return input.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `reactome:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('query', text)
  url.searchParams.set('species', 'Homo sapiens')
  url.searchParams.set('cluster', 'true')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000, headers: { Accept: 'application/json' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const entries = data?.results?.flatMap(group => group.entries ?? []) ?? []

  const documents = entries
    .slice(0, limit)
    .filter(entry => typeof entry.stId === 'string')
    .map(entry => {
      const stId = entry.stId as string
      const canonicalUrl = `https://reactome.org/content/detail/${stId}`
      return makeDocument({
        id: `reactome:${stId}`,
        provider: PROVIDER,
        providerRecordId: stId,
        title: entry.name ? stripHighlight(entry.name) : stId,
        summary: entry.summation ? stripHighlight(entry.summation).slice(0, 500) : null,
        contentSnippet: entry.type ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Reactome',
        contentType: 'pathway_record',
        authors: [],
        organization: 'Reactome',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { reactome_st_id: stId, ...(entry.dbId != null ? { reactome_db_id: String(entry.dbId) } : {}) },
        subjects: entry.type ? [entry.type] : [],
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
      throw new Error(`Reactome search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?query=apoptosis&species=Homo%20sapiens&cluster=true`, { timeoutMs: 10_000, headers: { Accept: 'application/json' } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const reactomeAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
