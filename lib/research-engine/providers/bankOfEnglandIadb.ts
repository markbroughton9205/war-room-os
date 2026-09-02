import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'bank_of_england_iadb' as const
const BASE_URL = 'https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp'
const MAX_RESULTS = 30
const DEFAULT_SERIES = 'IUDBEDR' // Bank of England Bank Rate (daily)
const SERIES_CODE_PATTERN = /^[A-Z0-9]{2,20}$/i
const LOOKBACK_DAYS = 120

function resolveSeriesCode(text: string): string {
  const trimmed = text.trim()
  return SERIES_CODE_PATTERN.test(trimmed) ? trimmed.toUpperCase() : DEFAULT_SERIES
}

function formatIadbDate(date: Date): string {
  // IADB expects e.g. "01/Jan/2024"
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  return `${day}/${month}/${date.getUTCFullYear()}`
}

function parseIadbCsv(text: string): Array<{ date: string; value: string }> {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const header = lines[0].toUpperCase()
  if (!header.startsWith('DATE,')) return []
  const points: Array<{ date: string; value: string }> = []
  for (const line of lines.slice(1)) {
    const comma = line.indexOf(',')
    if (comma < 0) continue
    const date = line.slice(0, comma).trim()
    const value = line.slice(comma + 1).trim()
    // A real observation row has a day-month-year date and a numeric value
    // (IADB emits blank cells for non-publication days — never synthesize those).
    if (!/^\d{2} [A-Za-z]{3} \d{4}$/.test(date)) continue
    if (!/^-?\d+(\.\d+)?$/.test(value)) continue
    points.push({ date, value })
  }
  return points
}

async function fetchSeries(query: ResearchQuery) {
  const started = Date.now()
  const seriesCode = resolveSeriesCode(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `bank_of_england_iadb:${seriesCode}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const to = new Date()
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const url = `${BASE_URL}?csv.x=yes&Datefrom=${formatIadbDate(from)}&Dateto=${formatIadbDate(to)}&SeriesCodes=${seriesCode}&UsingCodes=Y&VPD=Y`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (result.status === 404) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const points = parseIadbCsv(result.text)
  const canonicalUrl = `https://www.bankofengland.co.uk/boeapps/database/Rates.asp?Travel=NIx&into=GBP&rateview=D&seriesid=${seriesCode}`
  const documents = points
    .slice(-limit)
    .reverse()
    .map(point => makeDocument({
      id: `bank_of_england_iadb:${seriesCode}:${point.date}`,
      provider: PROVIDER,
      providerRecordId: `${seriesCode}:${point.date}`,
      title: `Bank of England IADB ${seriesCode} — ${point.date}`,
      summary: `Value: ${point.value}`,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'Bank of England Statistical Interactive Database',
      contentType: 'economic_time_series_point',
      authors: [],
      organization: 'Bank of England',
      publishedAt: point.date,
      updatedAt: null,
      geography: 'GB',
      language: 'en',
      identifiers: { boe_series: seriesCode },
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
      const outcome = await fetchSeries(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Bank of England IADB fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?csv.x=yes&Datefrom=01/Jan/2024&Dateto=05/Jan/2024&SeriesCodes=${DEFAULT_SERIES}&UsingCodes=Y&VPD=Y`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'IADB CSV endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const bankOfEnglandIadbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
