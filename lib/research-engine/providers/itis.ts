import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'itis' as const
const BASE_URL = 'https://www.itis.gov/ITISWebService/jsonservice'
const MAX_RESULTS = 20

type ItisRecord = { tsn?: string; combinedName?: string; author?: string; kingdom?: string }
type ItisResponse = { scientificNames?: (ItisRecord | null)[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `itis:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/searchByScientificName?srchKey=${encodeURIComponent(text)}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ItisResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.scientificNames)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ITIS response "scientificNames" field was missing or not an array.' }
  }

  const documents = data.scientificNames
    .filter((rec): rec is ItisRecord => Boolean(rec && rec.tsn && rec.combinedName))
    .slice(0, limit)
    .map(rec => {
      const tsn = rec.tsn as string
      const canonicalUrl = `https://www.itis.gov/servlet/SingleRpt/SingleRpt?search_topic=TSN&search_value=${tsn}`
      return makeDocument({
        id: `itis:${tsn}`,
        provider: PROVIDER,
        providerRecordId: tsn,
        title: rec.combinedName as string,
        summary: rec.author ? `Authority: ${rec.author}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Integrated Taxonomic Information System (ITIS)',
        contentType: 'species_taxonomy_record',
        authors: [],
        organization: 'ITIS',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { itis_tsn: tsn },
        subjects: rec.kingdom ? [rec.kingdom] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`ITIS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/searchByScientificName?srchKey=Ursus%20americanus`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'searchByScientificName reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const itisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
