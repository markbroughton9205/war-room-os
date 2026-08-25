import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'copernicus_dataspace' as const
const BASE_URL = 'https://catalogue.dataspace.copernicus.eu/odata/v1/Products'
const MAX_RESULTS = 20

type CdseProduct = { Id?: string; Name?: string; OriginDate?: string; ModificationDate?: string; Online?: boolean; ContentLength?: number }
type CdseResponse = { value?: CdseProduct[] }

/** Escapes a caller's text for safe interpolation into an OData `contains(Name,'...')` string literal (single-quote doubling, the OData escaping convention). */
function escapeODataLiteral(text: string): string {
  return text.replace(/'/g, "''")
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `copernicus_dataspace:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('$filter', `contains(Name,'${escapeODataLiteral(text)}')`)
  url.searchParams.set('$top', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CdseResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.value)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Copernicus Data Space response "value" field was missing or not an array.' }
  }

  const documents = data.value
    .filter(p => p.Id && p.Name)
    .map(p => {
      const id = p.Id as string
      const canonicalUrl = `https://browser.dataspace.copernicus.eu/?zoom=5&product=${id}`
      return makeDocument({
        id: `copernicus_dataspace:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: p.Name as string,
        summary: typeof p.ContentLength === 'number' ? `Size: ${(p.ContentLength / 1e6).toFixed(1)} MB` : null,
        contentSnippet: typeof p.Online === 'boolean' ? `Online: ${p.Online}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Copernicus Data Space Ecosystem',
        contentType: 'satellite_imagery_product',
        authors: [],
        organization: 'European Space Agency / Copernicus',
        publishedAt: p.OriginDate ?? null,
        updatedAt: p.ModificationDate ?? null,
        geography: null,
        language: null,
        identifiers: { cdse_product_id: id },
        subjects: [],
        license: null,
        accessStatus: p.Online ? 'open' : 'unknown',
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
      if (outcome.kind === 'http_error') throw new Error(`Copernicus Data Space search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?$top=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'products endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const copernicusDataspaceAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
