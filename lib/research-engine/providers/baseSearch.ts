import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'base_search' as const
const BASE_URL = 'https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi'
const MAX_RESULTS = 20

type BaseDoc = { dcdocid?: string; dctitle?: string; dcdate?: string; dclink?: string; dcprovider?: string }
type BaseResponse = { response?: { docs?: BaseDoc[] }; error?: string }

function apiKey(): string {
  return process.env.BASE_SEARCH_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `base_search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('func', 'PerformSearch')
  url.searchParams.set('query', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('hits', String(limit))
  url.searchParams.set('key', apiKey())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<BaseResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'BASE Search response was not a valid JSON object.' }
  }
  // BASE reports access errors (bad key, IP not allowlisted) as HTTP 200
  // with a top-level "error" field — detected explicitly, never silently
  // treated as an honest empty result.
  if (data.error) {
    return { ok: false as const, kind: 'malformed' as const, message: `BASE Search API error: ${data.error}` }
  }
  const docs = data.response?.docs
  if (!Array.isArray(docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'BASE Search response "response.docs" field was missing or not an array.' }
  }

  const documents = docs
    .filter(doc => doc.dcdocid && doc.dctitle)
    .map(doc => {
      const id = doc.dcdocid as string
      const canonicalUrl = doc.dclink ?? null
      return makeDocument({
        id: `base_search:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: doc.dctitle as string,
        summary: null,
        contentSnippet: doc.dcprovider ? `Source: ${doc.dcprovider}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'BASE (Bielefeld Academic Search Engine)',
        contentType: 'scholarly_work',
        authors: [],
        organization: doc.dcprovider ?? null,
        publishedAt: doc.dcdate ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { base_docid: id },
        subjects: [],
        license: null,
        accessStatus: 'unknown',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'BASE_SEARCH_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`BASE Search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'BASE_SEARCH_API_KEY missing', durationMs: null }
  }
  try {
    const url = `${BASE_URL}?func=PerformSearch&query=test&format=json&hits=1&key=${encodeURIComponent(apiKey())}`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const baseSearchAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
