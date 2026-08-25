import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'australia_frl' as const
const BASE_URL = 'https://api.prod.legislation.gov.au/v1/titles'
const MAX_RESULTS = 25

type Title = {
  id?: string
  name?: string
  makingDate?: string
  collection?: string
  isInForce?: boolean
  status?: string
  year?: number
  number?: string
}
type ODataResponse = { value?: Title[] }

/** Field is genuinely "name", not "title" (confirmed live: a bare "title"
 * filter 400s with "Could not find a property named 'title'"). */
function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a legislation title keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `australia_frl:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('$filter', `contains(name,'${escapeODataString(text)}')`)
  url.searchParams.set('$top', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ODataResponse>(result.text)
  if (!data || !Array.isArray(data.value)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Australia FRL response "value" field was missing or not an array.' }
  }

  const documents = data.value
    .filter(t => typeof t.id === 'string')
    .map(t => {
      const id = t.id as string
      const canonicalUrl = `https://www.legislation.gov.au/${id}`
      return makeDocument({
        id: `australia_frl:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: t.name ?? id,
        summary: t.collection ?? null,
        contentSnippet: `Status: ${t.status ?? 'unknown'}${t.isInForce ? ' (in force)' : ''}`,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Federal Register of Legislation (Australia)',
        contentType: 'legislation',
        authors: [],
        organization: 'Government of Australia',
        publishedAt: t.makingDate ?? null,
        updatedAt: null,
        geography: 'Australia',
        language: 'en',
        identifiers: { frl_id: id, ...(t.number ? { number: t.number } : {}) },
        subjects: t.collection ? [t.collection] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`Australia FRL search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?$filter=contains(name,'Corporations')&$top=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'titles endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const australiaFrlAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
