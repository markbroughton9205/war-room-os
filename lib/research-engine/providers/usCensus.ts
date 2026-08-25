import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'us_census' as const
const BASE_URL = 'https://api.census.gov/data'
const DEFAULT_YEAR = 2023
// A narrow, fixed variable list: total population only (B01001_001E), one
// well-known ACS 1-year table — not a general Census-variable proxy.
const VARIABLE = 'B01001_001E'

function apiKey(): string | null {
  return process.env.CENSUS_API_KEY?.trim() || null
}

/**
 * Census's JSON API returns an array-of-arrays (header row + data rows,
 * positionally matched), not array-of-objects. The API itself has no
 * free-text query parameter and requires numeric state FIPS codes (not
 * postal abbreviations) to scope a single state — rather than maintain a
 * 50-state FIPS lookup table, this adapter always requests every state
 * (`for=state:*`, one bounded call) and filters client-side by state name,
 * so a query like "california" or "CA" still narrows results honestly.
 */
async function fetchAllStateRows(): Promise<{ ok: true; rows: unknown[][] } | { ok: false; kind: 'http_error'; status: number } | { ok: false; kind: 'malformed'; message: string }> {
  const cacheKey = `us_census:acs1:${DEFAULT_YEAR}:all_states`
  const cached = cacheGet<unknown[][]>(cacheKey)
  if (cached) return { ok: true, rows: cached }

  const url = new URL(`${BASE_URL}/${DEFAULT_YEAR}/acs/acs1`)
  url.searchParams.set('get', `NAME,${VARIABLE}`)
  url.searchParams.set('for', 'state:*')
  const key = apiKey()
  if (key) url.searchParams.set('key', key)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false, kind: 'http_error', status: result.status }

  const rows = safeJsonParse<unknown[][]>(result.text)
  if (!Array.isArray(rows) || rows.length < 1 || !Array.isArray(rows[0])) {
    return { ok: false, kind: 'malformed', message: 'Census response was not the expected array-of-arrays shape.' }
  }
  cacheSet(cacheKey, rows, CACHE_TTL.timeSeries)
  return { ok: true, rows }
}

async function fetchAcs(query: ResearchQuery) {
  const started = Date.now()
  const outcome = await fetchAllStateRows()
  if (!outcome.ok) return outcome
  const rows = outcome.rows
  const header = rows[0] as string[]
  const nameIdx = header.indexOf('NAME')
  const valueIdx = header.indexOf(VARIABLE)
  const stateIdx = header.indexOf('state')
  if (nameIdx === -1 || valueIdx === -1) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Census response header did not include the expected NAME/variable columns.' }
  }

  const dataRows = rows.slice(1) as unknown[][]
  const filterText = query.text.trim().toLowerCase()
  const filtered = filterText
    ? dataRows.filter(row => String(row[nameIdx] ?? '').toLowerCase().includes(filterText))
    : dataRows
  const maxResults = Math.max(1, Math.min(query.maxResults ?? 20, 55))
  const documents = filtered.slice(0, maxResults).map(row => {
    const name = String(row[nameIdx] ?? 'Unknown geography')
    const value = row[valueIdx]
    const stateFips = stateIdx !== -1 ? String(row[stateIdx] ?? '') : ''
    const recordId = `${DEFAULT_YEAR}:${stateFips || name}`
    return makeDocument({
      id: `us_census:${recordId}`,
      provider: PROVIDER,
      providerRecordId: recordId,
      title: `${name} — total population (ACS 1-year, ${DEFAULT_YEAR})`,
      summary: `Estimate: ${value}`,
      contentSnippet: null,
      canonicalUrl: 'https://data.census.gov/table?q=B01001',
      sourceUrl: 'https://data.census.gov/table?q=B01001',
      sourceName: 'US Census Bureau',
      contentType: 'statistical_data_point',
      authors: [],
      organization: 'US Census Bureau',
      publishedAt: `${DEFAULT_YEAR}`,
      updatedAt: null,
      geography: name,
      language: 'en',
      identifiers: { census_variable: VARIABLE, ...(stateFips ? { state_fips: stateFips } : {}) },
      subjects: [],
      license: null,
      accessStatus: 'open',
    })
  })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchAcs(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Census ACS fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const key = apiKey()
    const url = `${BASE_URL}/${DEFAULT_YEAR}/acs/acs1?get=NAME,${VARIABLE}&for=state:06${key ? `&key=${encodeURIComponent(key)}` : ''}`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'ACS endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usCensusAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
