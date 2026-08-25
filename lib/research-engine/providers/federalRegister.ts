import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'federal_register' as const
const BASE_URL = 'https://www.federalregister.gov/api/v1/documents.json'
const MAX_RESULTS = 20

type FrDocument = { document_number?: string; title?: string; type?: string; abstract?: string | null; html_url?: string; publication_date?: string; agencies?: { name?: string }[] }
type FrResponse = { count?: number; results?: FrDocument[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `federal_register:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('conditions[term]', text)
  url.searchParams.set('per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<FrResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Federal Register response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(doc => doc.document_number && doc.title)
    .map(doc => {
      const id = doc.document_number as string
      const canonicalUrl = doc.html_url ?? `https://www.federalregister.gov/documents/${id}`
      return makeDocument({
        id: `federal_register:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: doc.title as string,
        summary: doc.abstract ?? null,
        contentSnippet: doc.type ? `Type: ${doc.type}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Federal Register',
        contentType: 'government_publication',
        authors: [],
        organization: doc.agencies?.[0]?.name ?? null,
        publishedAt: doc.publication_date ?? null,
        updatedAt: null,
        geography: 'US',
        language: 'en',
        identifiers: { federal_register_document_number: id },
        subjects: [],
        license: null,
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
      if (outcome.kind === 'http_error') throw new Error(`Federal Register search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?conditions[term]=climate&per_page=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'documents endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const federalRegisterAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
