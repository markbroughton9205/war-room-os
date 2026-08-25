import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'uk_ons' as const
const BASE_URL = 'https://api.beta.ons.gov.uk/v1/search'
const MAX_RESULTS = 20

type OnsItem = { title?: string; summary?: string; uri?: string; release_date?: string; type?: string }
type OnsResponse = { count?: number; items?: OnsItem[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `uk_ons:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OnsResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ONS response "items" field was missing or not an array.' }
  }

  const documents = data.items
    .filter(item => item.uri && item.title)
    .map(item => {
      const uri = item.uri as string
      const canonicalUrl = `https://www.ons.gov.uk${uri}`
      return makeDocument({
        id: `uk_ons:${uri}`,
        provider: PROVIDER,
        providerRecordId: uri,
        title: item.title as string,
        summary: item.summary ?? null,
        contentSnippet: item.type ? `Type: ${item.type}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'UK Office for National Statistics',
        contentType: 'statistical_publication',
        authors: [],
        organization: 'ONS',
        publishedAt: item.release_date ?? null,
        updatedAt: null,
        geography: 'UK',
        language: 'en',
        identifiers: { ons_uri: uri },
        subjects: [],
        license: 'Open Government Licence',
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`ONS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=population&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ukOnsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
