import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'datos_abiertos_colombia' as const
// Socrata's shared catalog-search API, scoped to the Colombia open-data
// domain (confirmed live) — a real cross-dataset search, not per-resource
// getById only.
const BASE_URL = 'https://api.us.socrata.com/api/catalog/v1'
const DOMAIN = 'www.datos.gov.co'
const MAX_RESULTS = 25

type Resource = { id?: string; name?: string; description?: string; attribution?: string; updatedAt?: string; createdAt?: string }
type Result = { resource?: Resource; classification?: { domain_category?: string; domain_tags?: string[] } }
type CatalogResponse = { results?: Result[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `datos_abiertos_colombia:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('domains', DOMAIN)
  url.searchParams.set('search_context', DOMAIN)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CatalogResponse>(result.text)
  if (!data || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Socrata catalog response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(r => typeof r.resource?.id === 'string')
    .map(r => {
      const resource = r.resource as Resource
      const id = resource.id as string
      const canonicalUrl = `https://www.datos.gov.co/d/${id}`
      return makeDocument({
        id: `datos_abiertos_colombia:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: resource.name ?? id,
        summary: resource.description ?? null,
        contentSnippet: r.classification?.domain_category ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Datos Abiertos Colombia',
        contentType: 'government_dataset',
        authors: [],
        organization: resource.attribution ?? null,
        publishedAt: resource.createdAt ?? null,
        updatedAt: resource.updatedAt ?? null,
        geography: 'CO',
        language: 'es',
        identifiers: { datos_abiertos_colombia_id: id },
        subjects: r.classification?.domain_tags ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`Datos Abiertos Colombia search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?domains=${DOMAIN}&q=salud&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'catalog endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const datosAbiertosColombiaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
