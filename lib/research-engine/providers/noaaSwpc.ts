import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'noaa_swpc' as const
const BASE_URL = 'https://services.swpc.noaa.gov'
const DEFAULT_PRODUCT = 'products/noaa-scales.json'
// A small, fixed set of allowlisted product files — not an open path passthrough.
const KNOWN_PRODUCTS: Record<string, string> = {
  scales: 'products/noaa-scales.json',
  'geomagnetic storm': 'products/noaa-scales.json',
  'radio blackout': 'products/noaa-scales.json',
  'solar wind': 'products/solar-wind/plasma-7-day.json',
  xray: 'json/goes/primary/xrays-7-day.json',
  'solar flare': 'json/goes/primary/xrays-7-day.json',
}

type ScaleEntry = { DateStamp?: string; TimeStamp?: string; R?: { Scale?: string; Text?: string }; S?: { Scale?: string; Text?: string }; G?: { Scale?: string; Text?: string } }
type ScalesResponse = Record<string, ScaleEntry>

function resolveProductPath(text: string): string {
  const trimmed = text.trim().toLowerCase()
  return KNOWN_PRODUCTS[trimmed] ?? DEFAULT_PRODUCT
}

async function fetchProduct(query: ResearchQuery) {
  const started = Date.now()
  const productPath = resolveProductPath(query.text)
  const cacheKey = `noaa_swpc:${productPath}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${productPath}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  // Only the noaa-scales.json shape (object keyed by forecast-day offset) is
  // parsed into structured fields this phase; other product files are
  // fetched via the same mechanism but not yet decoded field-by-field.
  if (productPath !== DEFAULT_PRODUCT) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const data = safeJsonParse<ScalesResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'NOAA SWPC scales response was not a valid JSON object.' }
  }

  const canonicalUrl = 'https://www.swpc.noaa.gov/noaa-scales-explanation'
  const documents = Object.entries(data)
    .filter(([, entry]) => entry.DateStamp)
    .map(([dayOffset, entry]) => makeDocument({
      id: `noaa_swpc:scales:${entry.DateStamp}`,
      provider: PROVIDER,
      providerRecordId: `scales:day+${dayOffset}`,
      title: `Space weather scales — ${entry.DateStamp}`,
      summary: `Radio blackout: R${entry.R?.Scale ?? '0'}, Solar radiation storm: S${entry.S?.Scale ?? '0'}, Geomagnetic storm: G${entry.G?.Scale ?? '0'}`,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: url,
      sourceName: 'NOAA Space Weather Prediction Center',
      contentType: 'space_weather_forecast',
      authors: [],
      organization: 'NOAA',
      publishedAt: entry.DateStamp ?? null,
      updatedAt: entry.TimeStamp ?? null,
      geography: null,
      language: 'en',
      identifiers: { day_offset: dayOffset },
      subjects: [],
      license: null,
      accessStatus: 'open',
    }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchProduct(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NOAA SWPC fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_PRODUCT}`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'scales product reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const noaaSwpcAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
