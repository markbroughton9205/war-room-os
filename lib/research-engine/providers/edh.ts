import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'edh' as const
const BASE_URL = 'https://edh.ub.uni-heidelberg.de/data/api/inschrift/suche'
const MAX_RESULTS = 25

type Item = {
  id?: string
  country?: string
  findspot_ancient?: string
  findspot_modern?: string
  transcription?: string
  diplomatic_text?: string
  type_of_inscription?: string
  type_of_monument?: string
  language?: string
  not_before?: string | number
  not_after?: string | number
  modern_region?: string
}
type SearchResponse = { items?: Item[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `edh:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('text', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'EDH response "items" field was missing or not an array.' }
  }

  const documents = data.items
    .slice(0, limit)
    .filter(item => typeof item.id === 'string')
    .map(item => {
      const id = item.id as string
      const canonicalUrl = `https://edh.ub.uni-heidelberg.de/edh/inschrift/${id}`
      const dateRange = item.not_before || item.not_after ? `${item.not_before ?? '?'}–${item.not_after ?? '?'}` : null
      return makeDocument({
        id: `edh:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: item.transcription?.slice(0, 120) ?? item.diplomatic_text?.slice(0, 120) ?? `Inscription ${id}`,
        summary: item.type_of_inscription ?? null,
        contentSnippet: item.findspot_ancient ?? item.findspot_modern ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Epigraphic Database Heidelberg',
        contentType: 'epigraphic_inscription',
        authors: [],
        organization: null,
        publishedAt: dateRange,
        updatedAt: null,
        geography: item.modern_region ?? item.country ?? null,
        language: item.language ?? null,
        identifiers: { edh_id: id },
        subjects: [item.type_of_monument].filter((v): v is string => !!v),
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
      if (outcome.kind === 'http_error') throw new Error(`EDH search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?text=Roma`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const edhAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
