import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'google_kg_search' as const
const BASE_URL = 'https://kgsearch.googleapis.com/v1/entities:search'
const MAX_RESULTS = 25

// Auth mechanism (key query param, real 403 PERMISSION_DENIED) confirmed
// live. This endpoint is on Google's free-quota API list — a standard GCP
// API key works without billing enabled. Response body shape not
// independently re-verified live (no key available this build).
type ResultItem = { result?: { '@id'?: string; name?: string; description?: string; url?: string } }
type SearchResponse = { itemListElement?: ResultItem[] }

function apiKey(): string {
  return process.env.GOOGLE_KG_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be an entity name.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `google_kg_search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('query', text)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('key', apiKey())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.itemListElement)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Google Knowledge Graph response "itemListElement" field was missing or not an array.' }
  }

  const documents = data.itemListElement
    .filter(item => typeof item.result?.['@id'] === 'string')
    .map(item => {
      const r = item.result as NonNullable<ResultItem['result']>
      const id = r['@id'] as string
      const canonicalUrl = r.url ?? `https://www.google.com/search?kgmid=${encodeURIComponent(id)}`
      return makeDocument({
        id: `google_kg_search:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: r.name ?? id,
        summary: r.description ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Google Knowledge Graph',
        contentType: 'knowledge_graph_entity',
        authors: [],
        organization: 'Google',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { google_kg_id: id },
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
    return notConfiguredResponse(PROVIDER, 'GOOGLE_KG_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Google Knowledge Graph search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'GOOGLE_KG_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?query=Einstein&limit=1&key=${apiKey()}`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'entities search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const googleKgSearchAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
