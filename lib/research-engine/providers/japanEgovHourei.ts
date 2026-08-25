import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'japan_egov_hourei' as const
const BASE_URL = 'https://laws.e-gov.go.jp/api/2'
const MAX_RESULTS = 25

type LawInfo = { law_id?: string; law_num?: string; promulgation_date?: string }
type RevisionInfo = { law_title?: string; category?: string; updated?: string }
type LawEntry = { law_info?: LawInfo; revision_info?: RevisionInfo }
type SearchResponse = { total_count?: number; laws?: LawEntry[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a Japanese law title or keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `japan_egov_hourei:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/laws`)
  url.searchParams.set('law_title', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.laws)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'e-Gov Hourei response "laws" field was missing or not an array.' }
  }

  const documents = data.laws
    .slice(0, limit)
    .filter(entry => typeof entry.law_info?.law_id === 'string')
    .map(entry => {
      const lawId = entry.law_info?.law_id as string
      const canonicalUrl = `https://laws.e-gov.go.jp/law/${lawId}`
      return makeDocument({
        id: `japan_egov_hourei:${lawId}`,
        provider: PROVIDER,
        providerRecordId: lawId,
        title: entry.revision_info?.law_title ?? lawId,
        summary: entry.law_info?.law_num ? `Law number: ${entry.law_info.law_num}` : null,
        contentSnippet: entry.revision_info?.category ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'e-Gov Hourei (Japan)',
        contentType: 'legislation',
        authors: [],
        organization: 'Government of Japan',
        publishedAt: entry.law_info?.promulgation_date ?? null,
        updatedAt: entry.revision_info?.updated ?? null,
        geography: 'Japan',
        language: 'ja',
        identifiers: { japan_law_id: lawId },
        subjects: entry.revision_info?.category ? [entry.revision_info.category] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`e-Gov Hourei search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/laws?law_title=%E6%86%B2%E6%B3%95`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'laws endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const japanEgovHoureiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
