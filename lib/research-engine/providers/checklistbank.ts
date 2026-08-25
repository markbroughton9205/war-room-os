import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'checklistbank' as const
const BASE_URL = 'https://api.checklistbank.org/nameusage/search'
const MAX_RESULTS = 25

type Name = { scientificName?: string; rank?: string }
type Usage = { id?: string; datasetKey?: string; name?: Name; status?: string; label?: string }
type Result = { usage?: Usage }
type SearchResponse = { result?: Result[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a taxon name.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `checklistbank:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.result)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ChecklistBank response "result" field was missing or not an array.' }
  }

  const documents = data.result
    .filter(r => typeof r.usage?.id === 'string')
    .map(r => {
      const usage = r.usage as Usage
      const id = usage.id as string
      const canonicalUrl = `https://www.catalogueoflife.org/data/taxon/${id}`
      return makeDocument({
        id: `checklistbank:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: usage.name?.scientificName ?? usage.label ?? id,
        summary: usage.status ? `Status: ${usage.status}` : null,
        contentSnippet: usage.name?.rank ? `Rank: ${usage.name.rank}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Catalogue of Life (ChecklistBank)',
        contentType: 'taxon_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { checklistbank_id: id, ...(usage.datasetKey ? { dataset_key: usage.datasetKey } : {}) },
        subjects: usage.name?.rank ? [usage.name.rank] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`ChecklistBank search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=Panthera+leo&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'nameusage search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const checklistbankAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
