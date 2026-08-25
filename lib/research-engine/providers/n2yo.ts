import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'n2yo' as const
const BASE_URL = 'https://api.n2yo.com/rest/v1/satellite/tle'
const NORAD_ID_PATTERN = /^\d{3,6}$/

// Real API, gated by a free self-service API key (account registration
// required). Query text is a NORAD catalog ID (e.g. "25544" for ISS).
type Info = { satname?: string; satid?: number; transactionscount?: number }
type TleResponse = { info?: Info; tle?: string }

function apiKey(): string {
  return process.env.N2YO_API_KEY?.trim() ?? ''
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const noradId = query.text.trim()
  if (!NORAD_ID_PATTERN.test(noradId)) {
    throw new Error('Query must be a NORAD catalog ID (e.g. "25544" for ISS).')
  }
  const cacheKey = `n2yo:${noradId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${noradId}&apiKey=${encodeURIComponent(apiKey())}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<TleResponse>(result.text)
  if (!data?.info?.satname) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://www.n2yo.com/satellite/?s=${noradId}`
  const documents = [makeDocument({
    id: `n2yo:${noradId}`,
    provider: PROVIDER,
    providerRecordId: noradId,
    title: data.info.satname,
    summary: data.tle ? `TLE: ${data.tle.slice(0, 120)}` : null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'N2YO Satellite Tracking',
    contentType: 'satellite_tle',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { norad_id: noradId },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'N2YO_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`N2YO lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'N2YO_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/25544&apiKey=${encodeURIComponent(apiKey())}`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'tle endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const n2yoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
