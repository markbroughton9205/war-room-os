import 'server-only'

import type { ResearchHealthStatus, ResearchQuery, ResearchTimeSeriesPoint } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { buildDefaultPxWebQuery, extractPxWebUnit, fetchPxWebTableMetadata, flattenJsonStat2, parseTableOverride, queryPxWebTable } from '@/lib/research-engine/providers/pxwebShared'

const PROVIDER = 'ssb_norway' as const

// Table 07459 — Population, by region/sex/age/year — Statistics Norway's own well-known table
// (confirmed live and current during this mission's verification), used as the fixed default
// only when the caller's query text does not name a different real table id via "table <id>".
const DEFAULT_TABLE = '07459'
const PERIODS = 5

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('SSB_NORWAY_API_BASE_URL', descriptor)) || 'https://data.ssb.no/api/v0/en/table'
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const table = parseTableOverride(query.text) ?? DEFAULT_TABLE
  const cacheKey = `ssb_norway:${table}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const tableUrl = `${baseUrl()}/${table}`
  const metadata = await fetchPxWebTableMetadata(PROVIDER, tableUrl)
  if (!metadata) return { ok: false as const, message: `Could not read PxWeb table metadata for "${table}". Use "table <id>" with a real SSB table id, e.g. table 07459.` }

  const pxQuery = buildDefaultPxWebQuery(metadata, PERIODS)
  const result = await queryPxWebTable(PROVIDER, tableUrl, pxQuery)
  if (!result.ok) return { ok: false as const, message: result.message }

  const cells = flattenJsonStat2(result.dataset)
  const timeVariable = metadata.variables.find(v => v.time)
  const unit = extractPxWebUnit(result.dataset)
  const points: ResearchTimeSeriesPoint[] = cells.map(cell => ({
    date: timeVariable ? cell.labels[timeVariable.code] ?? 'unknown' : 'unknown',
    value: cell.value,
    note: Object.entries(cell.labels)
      .filter(([code]) => code !== timeVariable?.code)
      .map(([, label]) => label)
      .join('; ') || null,
  }))

  const documents = [makeDocument({
    id: `ssb_norway:${table}`,
    provider: PROVIDER,
    providerRecordId: table,
    title: metadata.title || `SSB table ${table}`,
    summary: `Statistics Norway (SSB) PxWeb table ${table}.`,
    contentSnippet: null,
    canonicalUrl: tableUrl,
    sourceUrl: tableUrl,
    sourceName: 'Statistics Norway (SSB)',
    contentType: 'national_statistics_table',
    authors: [],
    organization: 'Statistisk sentralbyrå',
    publishedAt: null,
    updatedAt: null,
    geography: 'Norway',
    language: 'en',
    identifiers: { ssb_table_id: table },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]

  const timeSeries = [{ seriesId: `ssb_norway:${table}`, title: metadata.title || table, unit, frequency: null, points }]

  const response = okResponse(PROVIDER, { documents, timeSeries, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/${DEFAULT_TABLE}`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'table metadata endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ssbNorwayAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
