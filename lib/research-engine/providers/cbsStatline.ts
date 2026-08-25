import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cbs_statline' as const
const BASE_URL = 'https://opendata.cbs.nl/ODataApi/odata'
const MAX_RESULTS = 25
const DATASET_ID_PATTERN = /^\d+[A-Za-z]+$/
const DEFAULT_DATASET = '83765NED'

/** CBS StatLine has no free-text search across datasets — a caller must
 * already know a specific dataset ID (confirmed live); free text falls
 * back to a default population dataset. Row-level field names are
 * dataset-specific (Dutch, numeric-suffixed), so rows are surfaced as
 * generic key/value records rather than mapped to fixed fields. */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const trimmed = query.text.trim()
  const datasetId = DATASET_ID_PATTERN.test(trimmed) ? trimmed : DEFAULT_DATASET
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `cbs_statline:${datasetId}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${datasetId}/TypedDataSet`)
  url.searchParams.set('$top', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<{ value?: Record<string, unknown>[] }>(result.text)
  if (!data || !Array.isArray(data.value)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CBS StatLine response "value" field was missing or not an array.' }
  }

  const canonicalUrl = `https://opendata.cbs.nl/statline/#/CBS/en/dataset/${datasetId}/table`
  const documents = data.value.map((row, index) => {
    const rowId = String(row.ID ?? index)
    const summaryPairs = Object.entries(row).filter(([k]) => k !== 'ID').slice(0, 8)
    return makeDocument({
      id: `cbs_statline:${datasetId}:${rowId}`,
      provider: PROVIDER,
      providerRecordId: `${datasetId}:${rowId}`,
      title: `${datasetId} row ${rowId}`,
      summary: summaryPairs.map(([k, v]) => `${k}=${v}`).join(', ') || null,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'CBS StatLine (Netherlands)',
      contentType: 'statistical_record',
      authors: [],
      organization: 'Statistics Netherlands (CBS)',
      publishedAt: null,
      updatedAt: null,
      geography: 'Netherlands',
      language: 'nl',
      identifiers: { cbs_dataset_id: datasetId, row_id: rowId },
      subjects: [],
      license: null,
      accessStatus: 'open',
    })
  })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`CBS StatLine lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_DATASET}/TypedDataSet?$top=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'TypedDataSet endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cbsStatlineAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
