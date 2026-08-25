import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ebi_ols' as const
const BASE_URL = 'https://www.ebi.ac.uk/ols4/api'
const MAX_RESULTS = 20

type OlsDoc = { iri?: string; short_form?: string; obo_id?: string; ontology_name?: string; label?: string; description?: string[]; type?: string }
type OlsResponse = { response?: { numFound?: number; docs?: OlsDoc[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ebi_ols:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search`)
  url.searchParams.set('q', text)
  url.searchParams.set('rows', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OlsResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.response?.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OLS4 response "response.docs" field was missing or not an array.' }
  }

  const documents = data.response!.docs!
    .filter(doc => doc.iri && doc.label)
    .map(doc => {
      const id = doc.obo_id ?? doc.short_form ?? doc.iri!
      const canonicalUrl = `https://www.ebi.ac.uk/ols4/ontologies/${doc.ontology_name ?? 'unknown'}/classes/${encodeURIComponent(doc.iri!)}`
      return makeDocument({
        id: `ebi_ols:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: doc.label as string,
        summary: doc.description?.[0] ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: `EBI OLS (${doc.ontology_name ?? 'ontology'})`,
        contentType: 'ontology_term',
        authors: [],
        organization: 'EMBL-EBI',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { obo_id: id, ontology: doc.ontology_name ?? '' },
        subjects: doc.ontology_name ? [doc.ontology_name] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`OLS4 search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search?q=diabetes&rows=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ebiOlsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
