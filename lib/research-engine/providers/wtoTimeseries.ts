import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'wto_timeseries' as const
// Confirmed live via the R client "wtor" (github.com/fabiansalazares/wtor,
// R/get_timeseries.R): POST https://api.wto.org/timeseries/v1/data with
// header Ocp-Apim-Subscription-Key (Azure APIM-style), JSON body {"i":
// indicator code, "r": reporting economies csv, "p": partner economies csv,
// "ps": time period, "pc": product/sector, "spc": sub-product/sector}.
// Free API key issued at https://apiportal.wto.org/. Covers both the
// "Timeseries" (merchandise/services trade, tariffs) and "QR" (quantitative
// restrictions notifications) product families under one subscription key;
// this adapter wires only the Timeseries /data endpoint.
const BASE_URL = 'https://api.wto.org/timeseries/v1/data'
const MAX_RESULTS = 20

type WtoDataPoint = {
  IndicatorCode?: string
  IndicatorCategoryCode?: string
  ReportingEconomyCode?: string
  ReportingEconomy?: string
  PartnerEconomy?: string
  ProductOrSectorCode?: string
  ProductOrSector?: string
  Period?: string
  Year?: number
  Value?: number
  ValueFlagCode?: string
  Unit?: string
}
type WtoDataResponse = { Dataset?: WtoDataPoint[] }

function apiKey(): string {
  return process.env.WTO_API_KEY?.trim() ?? ''
}

/**
 * Query text must be a WTO indicator code (e.g. "ITS_MTV_AX" for total
 * merchandise exports) — the Timeseries API's /data endpoint has no
 * free-text search; indicator discovery is a separate /indicators endpoint
 * this adapter does not call this phase. Reporting economy defaults to
 * "all" (WTO's own wildcard code), matching the R client's documented
 * default when unspecified.
 */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const indicatorCode = query.text.trim().slice(0, 40)
  if (!indicatorCode) throw new Error('Query must be a WTO indicator code, e.g. "ITS_MTV_AX".')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `wto_timeseries:${indicatorCode}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const body = JSON.stringify({ i: indicatorCode, r: 'all', ps: 'default', max: limit })
  const result = await safeProviderFetch(PROVIDER, BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': apiKey() },
    body,
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<WtoDataResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.Dataset)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'WTO Timeseries response "Dataset" field was missing or not an array.' }
  }

  const documents = data.Dataset.slice(0, limit).map((row, index) => {
    const recordId = `${row.IndicatorCode ?? indicatorCode}:${row.ReportingEconomyCode ?? 'all'}:${row.Period ?? row.Year ?? index}`
    const title = [row.IndicatorCode ?? indicatorCode, row.ReportingEconomy, row.Period ?? String(row.Year ?? '')].filter(Boolean).join(' — ')
    return makeDocument({
      id: `wto_timeseries:${recordId}`,
      provider: PROVIDER,
      providerRecordId: recordId,
      title: title || recordId,
      summary: row.Value != null ? `${row.Value}${row.Unit ? ` ${row.Unit}` : ''}` : null,
      contentSnippet: row.ProductOrSector ?? null,
      canonicalUrl: 'https://timeseries.wto.org/',
      sourceUrl: 'https://timeseries.wto.org/',
      sourceName: 'WTO Timeseries',
      contentType: 'economic_time_series',
      authors: [],
      organization: 'World Trade Organization',
      publishedAt: row.Period ?? (row.Year != null ? String(row.Year) : null),
      updatedAt: null,
      geography: row.ReportingEconomy ?? null,
      language: 'en',
      identifiers: { wto_indicator_code: row.IndicatorCode ?? indicatorCode },
      subjects: row.ProductOrSector ? [row.ProductOrSector] : [],
      license: null,
      accessStatus: 'open',
    })
  })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'WTO_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`WTO Timeseries query failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'WTO_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': apiKey() },
      body: JSON.stringify({ i: 'ITS_MTV_AX', r: 'all', ps: 'default', max: 1 }),
      timeoutMs: 10_000,
    })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'data endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wtoTimeseriesAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
