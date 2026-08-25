import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'singstat' as const
const BASE_URL = 'https://tablebuilder.singstat.gov.sg/api/table/tabledata'
const TABLE_ID_PATTERN = /^M\d{6,9}$/i
const DEFAULT_TABLE = 'M810011' // Singapore residents by age group

type SeriesColumn = { key?: string; value?: string }
type TableRow = { seriesNo?: string; rowText?: string; uoM?: string; columns?: SeriesColumn[] }
type TableData = { title?: string; frequency?: string; footnote?: string; datasource?: string; row?: TableRow[] }
type TableResponse = { Data?: TableData }

/** Query text is a SingStat table resource ID like "M810011"; defaults to a residents-by-age table if not recognized. */
function resolveTableId(text: string): string {
  const trimmed = text.trim().toUpperCase()
  return TABLE_ID_PATTERN.test(trimmed) ? trimmed : DEFAULT_TABLE
}

async function fetchTable(query: ResearchQuery) {
  const started = Date.now()
  const tableId = resolveTableId(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `singstat:${tableId}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${tableId}?limit=${limit}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<TableResponse>(result.text)
  const table = data?.Data
  if (!table || !Array.isArray(table.row)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SingStat response "Data.row" field was missing or not an array.' }
  }

  const canonicalUrl = `https://tablebuilder.singstat.gov.sg/table/TS/${tableId}`
  const documents = table.row.slice(0, limit).map((row, index) => makeDocument({
    id: `singstat:${tableId}:${row.seriesNo ?? index}`,
    provider: PROVIDER,
    providerRecordId: `${tableId}:${row.seriesNo ?? index}`,
    title: `${table.title ?? tableId} — ${row.rowText ?? ''}`,
    summary: table.footnote ?? null,
    contentSnippet: row.columns?.length ? `Latest: ${row.columns[0]?.key} = ${row.columns[0]?.value}${row.uoM ? ` (${row.uoM})` : ''}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: table.datasource ?? 'Singapore Department of Statistics',
    contentType: 'statistical_table_row',
    authors: [],
    organization: 'Singapore Department of Statistics',
    publishedAt: null,
    updatedAt: null,
    geography: 'SG',
    language: 'en',
    identifiers: { singstat_table_id: tableId },
    subjects: [],
    license: null,
    accessStatus: 'open',
  }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchTable(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`SingStat fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_TABLE}?limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'tabledata endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const singstatAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
