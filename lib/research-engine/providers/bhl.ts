import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'bhl' as const
const BASE_URL = 'https://www.biodiversitylibrary.org/api3'

// Auth mechanism (apikey query param, real structured 401 error) confirmed
// live. Free self-service key via account registration. Response body
// shape for a valid key not independently re-verified live (no key
// available this build).
type Publication = { TitleID?: number | string; FullTitle?: string; PublisherName?: string; PublicationDate?: string }
type SearchResult = { Result?: Publication[] }
type SearchResponse = { Status?: string; Result?: SearchResult[] } | { Status?: string; Result?: Publication[] }

function apiKey(): string {
  return process.env.BHL_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `bhl:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('op', 'PublicationSearch')
  url.searchParams.set('searchterm', text)
  url.searchParams.set('searchtype', 'F')
  url.searchParams.set('apikey', apiKey())
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const rawResult = (data as { Result?: unknown })?.Result
  const publications: Publication[] = Array.isArray(rawResult) ? (rawResult as Publication[]) : []

  const documents = publications
    .slice(0, limit)
    .filter(p => p.TitleID != null)
    .map(p => {
      const titleId = String(p.TitleID)
      const canonicalUrl = `https://www.biodiversitylibrary.org/title/${titleId}`
      return makeDocument({
        id: `bhl:${titleId}`,
        provider: PROVIDER,
        providerRecordId: titleId,
        title: p.FullTitle ?? titleId,
        summary: p.PublisherName ?? null,
        contentSnippet: p.PublicationDate ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Biodiversity Heritage Library',
        contentType: 'natural_history_publication',
        authors: [],
        organization: p.PublisherName ?? null,
        publishedAt: p.PublicationDate ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { bhl_title_id: titleId },
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
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'BHL_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`BHL search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'BHL_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?op=PublicationSearch&searchterm=darwin&searchtype=F&apikey=${apiKey()}&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'PublicationSearch endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const bhlAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
