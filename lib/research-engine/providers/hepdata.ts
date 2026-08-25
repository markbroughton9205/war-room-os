import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'hepdata' as const
const BASE_URL = 'https://www.hepdata.net/record'
const RECORD_ID_PATTERN = /^\d{1,10}$/

type DataTable = { id?: number; name?: string; description?: string; doi?: string }
type HepDataRecord = { data_tables?: DataTable[]; breadcrumb_text?: string; access_count?: { sum?: number } }

/**
 * HEPData's free-text /search/ endpoint is blocked by a Cloudflare bot
 * challenge (confirmed during research — returns an HTML JS-challenge page,
 * not JSON, even with format=json) — this adapter is getById-only, keyed by
 * the INSPIRE literature record ID, never oversold as free-text search.
 */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const recordId = query.text.trim()
  if (!RECORD_ID_PATTERN.test(recordId)) {
    throw new Error('Query must be a numeric INSPIRE/HEPData record ID (e.g. "1283842") — HEPData\'s free-text search is not programmatically accessible.')
  }
  const cacheKey = `hepdata:${recordId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${recordId}?format=json`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (result.status === 404) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<HepDataRecord>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'HEPData response was not a valid JSON object.' }
  }

  const canonicalUrl = `https://www.hepdata.net/record/${recordId}`
  const tableCount = data.data_tables?.length ?? 0
  const documents = [makeDocument({
    id: `hepdata:${recordId}`,
    provider: PROVIDER,
    providerRecordId: recordId,
    title: data.breadcrumb_text ?? `HEPData record ${recordId}`,
    summary: tableCount > 0 ? `${tableCount} data table(s)` : null,
    contentSnippet: data.data_tables?.[0]?.description ?? null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'HEPData',
    contentType: 'experimental_dataset',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { hepdata_record_id: recordId, ...(data.data_tables?.[0]?.doi ? { doi: data.data_tables[0].doi as string } : {}) },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`HEPData fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/1283842?format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'record endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const hepdataAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
