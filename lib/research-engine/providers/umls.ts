import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'umls' as const
const BASE_URL = 'https://uts-ws.nlm.nih.gov/rest/search/current'
const MAX_RESULTS = 25

// Auth mechanism (apiKey query param, real 401 structured error) confirmed
// live. Free self-service key via UTS account registration + one-time
// license click-through (no manual approval step at the API-key level).
// Response body shape for a valid key not independently re-verified live
// (no key available this build).
type Result = { ui?: string; name?: string; rootSource?: string }
type SearchPage = { results?: Result[] }
type SearchResponse = { result?: SearchPage }

function apiKey(): string {
  return process.env.UMLS_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a clinical term (e.g. "diabetes").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `umls:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('string', text)
  url.searchParams.set('apiKey', apiKey())
  url.searchParams.set('pageSize', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const results = data?.result?.results
  if (!Array.isArray(results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'UMLS response "result.results" field was missing or not an array.' }
  }

  const documents = results
    .filter(r => typeof r.ui === 'string' && r.ui !== 'NONE')
    .map(r => {
      const cui = r.ui as string
      const canonicalUrl = `https://uts.nlm.nih.gov/uts/umls/concept/${cui}`
      return makeDocument({
        id: `umls:${cui}`,
        provider: PROVIDER,
        providerRecordId: cui,
        title: r.name ?? cui,
        summary: r.rootSource ? `Source vocabulary: ${r.rootSource}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'UMLS Metathesaurus',
        contentType: 'clinical_concept',
        authors: [],
        organization: 'National Library of Medicine',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { umls_cui: cui },
        subjects: r.rootSource ? [r.rootSource] : [],
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
    return notConfiguredResponse(PROVIDER, 'UMLS_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`UMLS search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'UMLS_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?string=diabetes&apiKey=${apiKey()}`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const umlsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
