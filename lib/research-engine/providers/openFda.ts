import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'openfda' as const
const BASE_URL = 'https://api.fda.gov'
const MAX_RESULTS = 20

type OpenFdaLabel = {
  id?: string
  effective_time?: string
  indications_and_usage?: string[]
  description?: string[]
  openfda?: { brand_name?: string[]; generic_name?: string[]; manufacturer_name?: string[]; substance_name?: string[]; spl_id?: string[] }
}
type OpenFdaResponse = { results?: OpenFdaLabel[] }

function apiKey(): string | null {
  return process.env.OPENFDA_API_KEY?.trim() || null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 300)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `openfda:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/drug/label.json`)
  // openFDA search syntax is Lucene-like; a bare term is matched against the
  // full label text. Field-scoped queries (e.g. "openfda.brand_name:aspirin")
  // are passed through as-is if the caller already wrote them that way.
  url.searchParams.set('search', text || 'aspirin')
  url.searchParams.set('limit', String(limit))
  const key = apiKey()
  if (key) url.searchParams.set('api_key', key)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (result.status === 404) {
    // openFDA returns 404 for a zero-result query rather than an empty array — an honest empty result, not an error.
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OpenFdaResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'openFDA response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .map(label => {
      const id = typeof label.id === 'string' && label.id ? label.id : null
      if (!id) return null
      const brandName = label.openfda?.brand_name?.[0] ?? label.openfda?.generic_name?.[0] ?? 'Untitled drug label'
      const splId = label.openfda?.spl_id?.[0]
      const canonicalUrl = splId ? `https://www.accessdata.fda.gov/spl/data/${splId}/${splId}.xml` : null
      return makeDocument({
        id: `openfda:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: brandName,
        summary: label.indications_and_usage?.[0] ?? label.description?.[0] ?? null,
        contentSnippet: label.indications_and_usage?.[0] ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'openFDA',
        contentType: 'drug_label',
        authors: [],
        organization: label.openfda?.manufacturer_name?.[0] ?? null,
        publishedAt: label.effective_time ?? null,
        updatedAt: label.effective_time ?? null,
        geography: 'US',
        language: 'en',
        identifiers: { openfda_id: id, ...(splId ? { spl_id: splId } : {}) },
        subjects: label.openfda?.substance_name ?? [],
        license: null,
        accessStatus: 'open',
      })
    })
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`openFDA search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/drug/label.json?search=aspirin&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'drug label endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const openFdaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
