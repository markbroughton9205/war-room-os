import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'usgs_national_map' as const
const MAX_RESULTS = 20

// Confirmed live (this mission) via a direct probe: GET /products?q=<text>,
// unauthenticated, real JSON product-catalog search (The National Map's
// TNM Access API — datasets, elevation, hydrography, imagery products).
type TnmItem = {
  title?: string
  moreInfo?: string
  sourceId?: string
  metaUrl?: string
  publicationDate?: string
  lastUpdated?: string
  extent?: string
  format?: string
  downloadURL?: string
}
type TnmResponse = { total?: number; items?: TnmItem[] }

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('USGS_NATIONAL_MAP_API_BASE_URL', descriptor)) || 'https://tnmaccess.nationalmap.gov/api/v1'
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a free-text term to search The National Map product catalog, e.g. "Alaska hydrography".')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `usgs_national_map:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/products`)
  url.searchParams.set('q', text)
  url.searchParams.set('max', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<TnmResponse>(result.text)
  const items = data?.items
  if (!Array.isArray(items)) return { ok: false as const, kind: 'malformed' as const, message: 'USGS National Map response was missing the "items" array.' }

  const documents = items.slice(0, limit).filter(item => item.title && item.sourceId).map(item => {
    const id = item.sourceId as string
    const canonicalUrl = item.metaUrl ?? item.downloadURL ?? `https://www.sciencebase.gov/catalog/item/${id}`
    return makeDocument({
      id: `usgs_national_map:${id}`,
      provider: PROVIDER,
      providerRecordId: id,
      title: item.title as string,
      summary: item.moreInfo ?? null,
      contentSnippet: [item.extent, item.format].filter(Boolean).join(' — ') || null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'USGS The National Map',
      contentType: 'geospatial_dataset',
      authors: [],
      organization: 'U.S. Geological Survey',
      publishedAt: item.publicationDate ?? null,
      updatedAt: item.lastUpdated ?? null,
      geography: item.extent ?? null,
      language: 'en',
      identifiers: { usgs_tnm_source_id: id },
      subjects: item.format ? [item.format] : [],
      license: 'Public Domain (U.S. Government Work)',
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
      if (outcome.kind === 'http_error') throw new Error(`USGS National Map search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/products?q=water&max=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'products endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usgsNationalMapAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
