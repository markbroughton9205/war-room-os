import 'server-only'

import type { ResearchHealthStatus, ResearchQuery, ResearchTimeSeries } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'world_bank_indicators' as const

// Bounds the observation count requested from the API and, defensively, the
// count actually normalized even if an upstream response were to return more
// rows than requested.
const MAX_OBSERVATIONS = 60

type WorldBankPageMeta = { page: number; pages: number; per_page: number; total: number; lastupdated?: string }
type WorldBankObservation = {
  indicator: { id: string; value: string }
  country: { id: string; value: string }
  countryiso3code: string
  date: string
  value: number | null
  unit: string
  obs_status: string
}
// The World Bank API's signature two-element array response: [pageMeta, dataRows].
type WorldBankResponse = [WorldBankPageMeta, WorldBankObservation[] | null]

// The World Bank API's documented error shape: a single-element array whose
// object carries a `message` array, e.g. [{ message: [{ id, key, value }] }].
// It is returned with HTTP 200, so it must be distinguished from the normal
// two-element success shape by inspecting the parsed body, not the status code.
type WorldBankErrorEntry = { id?: string; key?: string; value?: string }
type WorldBankErrorResponse = [{ message?: WorldBankErrorEntry[] }]

class WorldBankProviderError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

/** Detects the documented World Bank error shape and returns a safe, non-internal message, or null if `parsed` isn't that shape. */
function extractWorldBankApiError(parsed: unknown): string | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const first = (parsed as WorldBankErrorResponse)[0]
  if (!first || typeof first !== 'object' || !('message' in first)) return null
  const entries = first.message
  if (!Array.isArray(entries) || entries.length === 0) return 'World Bank Indicators API returned an error.'
  const entry = entries[0]
  const text = typeof entry?.value === 'string' && entry.value.trim()
    ? entry.value.trim()
    : typeof entry?.key === 'string' && entry.key.trim()
      ? entry.key.trim()
      : 'World Bank Indicators API returned an error.'
  return `World Bank Indicators API error: ${text}`
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('WORLD_BANK_API_BASE_URL', descriptor)) || 'https://api.worldbank.org/v2'
}

/** Query shape: an indicator code, optionally "CODE for COUNTRY", e.g. "NY.GDP.MKTP.CD for USA". Defaults to the World aggregate (WLD). */
function parseIndicatorQuery(text: string): { indicatorCode: string; country: string } {
  const match = /^\s*([A-Za-z0-9.]+)\s*(?:for\s+([A-Za-z]{2,3}))?\s*$/.exec(text)
  if (!match) return { indicatorCode: text.trim(), country: 'WLD' }
  return { indicatorCode: match[1], country: (match[2] ?? 'WLD').toUpperCase() }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const { indicatorCode, country } = parseIndicatorQuery(query.text)
  const cacheKey = `world_bank_indicators:${indicatorCode}:${country}`
  const cached = cacheGet<{ documents: ReturnType<typeof makeDocument>[]; timeSeries: ResearchTimeSeries[] }>(cacheKey)
  if (cached) return { ok: true as const, response: okResponse(PROVIDER, { ...cached, durationMs: Date.now() - started, fromCache: true }) }

  const url = new URL(`${baseUrl()}/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicatorCode)}`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('per_page', String(MAX_OBSERVATIONS))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<unknown>(result.text)
  if (parsed === null) {
    return { ok: false as const, kind: 'malformed' as const, message: 'World Bank Indicators response could not be parsed as JSON.' }
  }

  const apiError = extractWorldBankApiError(parsed)
  if (apiError) {
    return { ok: false as const, kind: 'api_error' as const, message: apiError }
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return { ok: false as const, kind: 'malformed' as const, message: 'World Bank Indicators response was not the expected two-element [pageMeta, observations] shape.' }
  }
  const [, dataRows] = parsed as WorldBankResponse
  if (dataRows !== null && !Array.isArray(dataRows)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'World Bank Indicators observations field was not an array or null.' }
  }

  const rows = (dataRows ?? []).slice(0, MAX_OBSERVATIONS)
  if (rows.length === 0) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], timeSeries: [], durationMs: Date.now() - started }) }

  const points = [...rows].reverse().map(row => ({ date: row.date, value: row.value, note: row.obs_status || null }))
  const timeSeries: ResearchTimeSeries[] = [{ seriesId: `${indicatorCode}:${country}`, title: rows[0].indicator.value, unit: rows[0].unit || null, frequency: 'annual', points }]
  const documents = [makeDocument({
    id: `world_bank_indicators:${indicatorCode}:${country}`,
    provider: PROVIDER,
    providerRecordId: `${indicatorCode}:${country}`,
    title: `${rows[0].indicator.value} — ${rows[0].country.value}`,
    summary: `World Bank World Development Indicators series ${indicatorCode} for ${rows[0].country.value}.`,
    contentSnippet: null,
    canonicalUrl: `https://data.worldbank.org/indicator/${encodeURIComponent(indicatorCode)}?locations=${encodeURIComponent(country)}`,
    sourceUrl: `https://data.worldbank.org/indicator/${encodeURIComponent(indicatorCode)}?locations=${encodeURIComponent(country)}`,
    sourceName: 'World Bank Open Data',
    contentType: 'economic_time_series',
    authors: [],
    organization: 'World Bank',
    publishedAt: null,
    updatedAt: null,
    geography: rows[0].country.value,
    language: 'en',
    identifiers: { world_bank_indicator: indicatorCode, world_bank_country: country },
    subjects: [],
    license: 'CC BY-4.0',
    accessStatus: 'open',
  })]

  cacheSet(cacheKey, { documents, timeSeries }, CACHE_TTL.timeSeries)
  return { ok: true as const, response: okResponse(PROVIDER, { documents, timeSeries, durationMs: Date.now() - started }) }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new WorldBankProviderError(`World Bank Indicators search failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new WorldBankProviderError(outcome.message, outcome.kind === 'api_error' ? 'upstream_error' : 'parse_error')
    })
  } catch (error) {
    if (error instanceof WorldBankProviderError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/country/WLD/indicator/NY.GDP.MKTP.CD?format=json&per_page=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'indicator endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const worldBankIndicatorsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
