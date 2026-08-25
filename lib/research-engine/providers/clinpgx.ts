import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'clinpgx' as const
// api.pharmgkb.org (the historical host) no longer resolves at all
// (confirmed live this mission) — the real successor is api.clinpgx.org.
const BASE_URL = 'https://api.clinpgx.org/v1/data/drug'
const MAX_RESULTS = 25

type DrugEntry = { id?: string; name?: string; pediatric?: boolean; types?: string[] }
type DrugResponse = { data?: DrugEntry[] }

/** ClinPGx (PharmGKB's successor) has no generic free-text "search" object
 * type — must query a specific ObjectType (confirmed live). This adapter
 * targets "drug", the confirmed-working type. */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a drug name (e.g. "warfarin").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `clinpgx:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('name', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<DrugResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = data.data
    .slice(0, limit)
    .filter(d => typeof d.id === 'string')
    .map(d => {
      const id = d.id as string
      const canonicalUrl = `https://www.clinpgx.org/chemical/${id}`
      return makeDocument({
        id: `clinpgx:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: d.name ?? id,
        summary: d.types?.length ? `Type: ${d.types.join(', ')}` : null,
        contentSnippet: d.pediatric ? 'Pediatric relevance noted' : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ClinPGx (PharmGKB)',
        contentType: 'pharmacogenomics_drug',
        authors: [],
        organization: 'ClinPGx',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { clinpgx_id: id },
        subjects: d.types ?? [],
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
      throw new Error(`ClinPGx search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?name=warfarin`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'drug endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const clinpgxAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
