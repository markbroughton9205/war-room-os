import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'who_gho' as const
const BASE_URL = 'https://ghoapi.azureedge.net/api'
const MAX_RESULTS = 20
const INDICATOR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,40}$/

/**
 * The GHO OData API has no server-side free-text search over its ~2,300
 * indicators — a real API constraint, same shape as this codebase's eurostat
 * adapter. A small fixed keyword lookup covers common queries; a caller can
 * also pass an exact indicator code directly.
 */
const KEYWORD_TO_INDICATOR: Record<string, string> = {
  'life expectancy': 'WHOSIS_000001',
  'maternal mortality': 'MDG_0000000026',
  'infant mortality': 'MDG_0000000001',
  tuberculosis: 'MDG_0000000017',
  malaria: 'MALARIA_EST_INCIDENCE',
  hiv: 'HIV_0000000001',
  obesity: 'NCD_BMI_30A',
}

type GhoRow = { Id?: number; IndicatorCode?: string; SpatialDim?: string; ParentLocation?: string; TimeDim?: number; Value?: string; NumericValue?: number; Date?: string }
type GhoResponse = { value?: GhoRow[] }

function looksLikeIndicatorCode(text: string): boolean {
  return INDICATOR_CODE_PATTERN.test(text) && text === text.toUpperCase()
}

function resolveIndicatorCode(text: string): string | null {
  const trimmed = text.trim()
  if (looksLikeIndicatorCode(trimmed)) return trimmed
  return KEYWORD_TO_INDICATOR[trimmed.toLowerCase()] ?? null
}

async function fetchIndicator(query: ResearchQuery) {
  const started = Date.now()
  const code = resolveIndicatorCode(query.text)
  if (!code) {
    throw new Error(`Query must be a known keyword (${Object.keys(KEYWORD_TO_INDICATOR).join(', ')}) or an exact GHO indicator code — the GHO API has no free-text search.`)
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `who_gho:${code}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${encodeURIComponent(code)}?$top=${limit}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GhoResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.value)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'WHO GHO response "value" field was missing or not an array.' }
  }

  const canonicalUrl = `https://www.who.int/data/gho/data/indicators/indicator-details/GHO/${code}`
  const documents = data.value
    .filter(row => typeof row.Id === 'number')
    .map(row => makeDocument({
      id: `who_gho:${code}:${row.Id}`,
      provider: PROVIDER,
      providerRecordId: String(row.Id),
      title: `${code} — ${row.SpatialDim ?? 'unknown geography'} (${row.TimeDim ?? 'unknown year'})`,
      summary: row.Value ?? (typeof row.NumericValue === 'number' ? String(row.NumericValue) : null),
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'WHO Global Health Observatory',
      contentType: 'statistical_data_point',
      authors: [],
      organization: 'World Health Organization',
      publishedAt: row.TimeDim ? String(row.TimeDim) : null,
      updatedAt: row.Date ?? null,
      geography: row.ParentLocation ?? row.SpatialDim ?? null,
      language: 'en',
      identifiers: { who_indicator_code: code },
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
      const outcome = await fetchIndicator(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`WHO GHO fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/WHOSIS_000001?$top=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'indicator endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const whoGhoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
