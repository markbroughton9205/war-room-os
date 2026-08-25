import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'health_canada_dpd' as const
const BASE_URL = 'https://health-products.canada.ca/api/drug/drugproduct/'
const MAX_RESULTS = 25

type DrugProduct = {
  drug_code?: number | string
  class_name?: string
  drug_identification_number?: string
  brand_name?: string
  descriptor?: string
  company_name?: string
  last_update_date?: string
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a drug brand name (e.g. "Tylenol").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `health_canada_dpd:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('brandname', text)
  url.searchParams.set('lang', 'en')
  url.searchParams.set('type', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<DrugProduct[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = data
    .slice(0, limit)
    .filter(d => d.drug_code != null)
    .map(d => {
      const drugCode = String(d.drug_code)
      const canonicalUrl = `https://health-products.canada.ca/dpd-bdpp/info?lang=en&code=${drugCode}`
      return makeDocument({
        id: `health_canada_dpd:${drugCode}`,
        provider: PROVIDER,
        providerRecordId: drugCode,
        title: d.brand_name ?? drugCode,
        summary: d.descriptor ?? null,
        contentSnippet: d.class_name ? `Class: ${d.class_name}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Health Canada Drug Product Database',
        contentType: 'drug_product',
        authors: [],
        organization: d.company_name ?? 'Health Canada',
        publishedAt: null,
        updatedAt: d.last_update_date ?? null,
        geography: 'Canada',
        language: 'en',
        identifiers: { drug_code: drugCode, ...(d.drug_identification_number ? { din: d.drug_identification_number } : {}) },
        subjects: d.class_name ? [d.class_name] : [],
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
      throw new Error(`Health Canada DPD search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?brandname=tylenol&lang=en&type=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'drugproduct endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const healthCanadaDpdAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
