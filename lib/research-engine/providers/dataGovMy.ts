import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'data_gov_my' as const
const BASE_URL = 'https://api.data.gov.my/data-catalogue/'
const DATASET_ID_PATTERN = /^[a-z0-9_]{3,80}$/
const DEFAULT_DATASET = 'population_state'
const MAX_ROWS = 50

// Real endpoint returns the entire dataset as an unfiltered JSON array with
// no query/pagination param (confirmed live: a single dataset was 3.25MB) —
// this is a getById-by-dataset-id lookup, sliced client-side after fetch,
// not a fake search API.
type Row = Record<string, string | number | null>

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const trimmed = query.text.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const datasetId = DATASET_ID_PATTERN.test(trimmed) ? trimmed : DEFAULT_DATASET
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_ROWS))
  const cacheKey = `data_gov_my:${datasetId}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('id', datasetId)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 30_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Row[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'data.gov.my response was not a JSON array.' }
  }

  const canonicalUrl = `https://data.gov.my/data-catalogue/${datasetId}`
  const documents = data.slice(0, limit).map((row, index) => makeDocument({
    id: `data_gov_my:${datasetId}:${index}`,
    provider: PROVIDER,
    providerRecordId: `${datasetId}:${index}`,
    title: `${datasetId} — row ${index + 1}`,
    summary: JSON.stringify(row).slice(0, 400),
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'data.gov.my (Malaysia Open Data)',
    contentType: 'government_dataset_row',
    authors: [],
    organization: 'Government of Malaysia',
    publishedAt: typeof row.date === 'string' ? row.date : null,
    updatedAt: null,
    geography: typeof row.state === 'string' ? row.state : 'MY',
    language: 'en',
    identifiers: { data_gov_my_dataset: datasetId },
    subjects: [],
    license: null,
    accessStatus: 'open',
  }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`data.gov.my lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?id=${DEFAULT_DATASET}`, { timeoutMs: 20_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'catalogue endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const dataGovMyAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
