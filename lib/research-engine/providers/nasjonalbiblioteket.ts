import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nasjonalbiblioteket' as const
const BASE_URL = 'https://api.nb.no/catalog/v1/items'
const MAX_RESULTS = 25

type Links = { self?: { href?: string }; thumbnail_medium?: { href?: string } }
type AccessInfo = { isPublicDomain?: boolean; license?: string; viewability?: string }
type Metadata = { title?: string; creators?: string[]; contentClasses?: string[] }
type Item = { id?: string; _links?: Links; accessInfo?: AccessInfo; metadata?: Metadata }
type EmbeddedItems = { items?: Item[] }
type SearchResponse = { _embedded?: EmbeddedItems }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `nasjonalbiblioteket:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const items = data?._embedded?.items
  if (!Array.isArray(items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Nasjonalbiblioteket response "_embedded.items" field was missing or not an array.' }
  }

  const documents = items
    .filter(item => typeof item.id === 'string')
    .map(item => {
      const id = item.id as string
      const canonicalUrl = item._links?.self?.href ?? `https://www.nb.no/items/${id}`
      return makeDocument({
        id: `nasjonalbiblioteket:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: item.metadata?.title ?? id,
        summary: item.metadata?.creators?.length ? `By ${item.metadata.creators.join(', ')}` : null,
        contentSnippet: item.metadata?.contentClasses?.join(', ') ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Nasjonalbiblioteket (National Library of Norway)',
        contentType: 'library_record',
        authors: item.metadata?.creators ?? [],
        organization: 'National Library of Norway',
        publishedAt: null,
        updatedAt: null,
        geography: 'Norway',
        language: 'no',
        identifiers: { nb_item_id: id },
        subjects: item.metadata?.contentClasses ?? [],
        license: item.accessInfo?.license ?? null,
        accessStatus: item.accessInfo?.isPublicDomain ? 'open' : 'unknown',
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
      if (outcome.kind === 'http_error') throw new Error(`Nasjonalbiblioteket search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=Ibsen&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'items endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nasjonalbibliotekAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
