import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'statcan_wds' as const
const BASE_URL = 'https://www150.statcan.gc.ca/t1/wds/rest'
const MAX_RESULTS = 20

/**
 * StatCan WDS has no free-text search endpoint — every call must already
 * carry a numeric vectorId. A small fixed keyword lookup covers common
 * queries, same pattern as this codebase's eurostat/who_gho adapters; a
 * caller can also pass a vectorId directly.
 */
const KEYWORD_TO_VECTOR: Record<string, number> = {
  cpi: 41690973,
  'consumer price index': 41690973,
  inflation: 41690973,
  unemployment: 2062815,
  gdp: 65201210,
}
const VECTOR_ID_PATTERN = /^\d{3,10}$/

type VectorDataPoint = { refPer?: string; value?: number; releaseTime?: string }
type WdsResult = { status?: string; object?: { vectorId?: number; vectorDataPoint?: VectorDataPoint[] } }

function resolveVectorId(text: string): number | null {
  const trimmed = text.trim()
  if (VECTOR_ID_PATTERN.test(trimmed)) return Number(trimmed)
  return KEYWORD_TO_VECTOR[trimmed.toLowerCase()] ?? null
}

async function fetchVector(query: ResearchQuery) {
  const started = Date.now()
  const vectorId = resolveVectorId(query.text)
  if (!vectorId) {
    throw new Error(`Query must be a known keyword (${Object.keys(KEYWORD_TO_VECTOR).join(', ')}) or a numeric StatCan vectorId — WDS has no free-text search.`)
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `statcan_wds:${vectorId}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/getDataFromVectorsAndLatestNPeriods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ vectorId, latestN: limit }]),
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<WdsResult[]>(result.text)
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed[0].status !== 'SUCCESS') {
    return { ok: false as const, kind: 'malformed' as const, message: 'StatCan WDS response was not a successful array result.' }
  }

  const points = parsed[0].object?.vectorDataPoint ?? []
  const canonicalUrl = `https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods`
  const documents = points
    .filter(point => point.refPer && typeof point.value === 'number')
    .map(point => makeDocument({
      id: `statcan_wds:${vectorId}:${point.refPer}`,
      provider: PROVIDER,
      providerRecordId: `${vectorId}:${point.refPer}`,
      title: `Vector ${vectorId} — ${point.refPer}`,
      summary: `Value: ${point.value}`,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'Statistics Canada',
      contentType: 'economic_time_series_point',
      authors: [],
      organization: 'Statistics Canada',
      publishedAt: point.refPer ?? null,
      updatedAt: point.releaseTime ?? null,
      geography: 'CA',
      language: 'en',
      identifiers: { statcan_vector_id: String(vectorId) },
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
      const outcome = await fetchVector(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`StatCan WDS fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/getDataFromVectorsAndLatestNPeriods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ vectorId: 41690973, latestN: 1 }]),
      timeoutMs: 10_000,
    })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'WDS endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const statcanWdsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
