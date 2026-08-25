import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'israel_cbs' as const
const BASE_URL = 'https://api.cbs.gov.il/index/data/price'
const INDEX_CODE_PATTERN = /^\d{4,8}$/
const DEFAULT_INDEX = '120010' // CPI general

type MonthEntry = { year?: number; percent?: number; percentYear?: number; currBase?: { baseDesc?: string; value?: number }; month?: number; monthDesc?: string }
type MonthGroup = { code?: number; name?: string; date?: MonthEntry[] }
type PriceResponse = { month?: MonthGroup[] }

/** Query text is a numeric CBS index code (e.g. "120010" for CPI general); defaults to CPI general if not numeric. */
function resolveIndexCode(text: string): string {
  const trimmed = text.trim()
  return INDEX_CODE_PATTERN.test(trimmed) ? trimmed : DEFAULT_INDEX
}

async function fetchIndex(query: ResearchQuery) {
  const started = Date.now()
  const indexCode = resolveIndexCode(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `israel_cbs:${indexCode}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('id', indexCode)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PriceResponse>(result.text)
  const group = data?.month?.[0]
  if (!group || !Array.isArray(group.date)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://www.cbs.gov.il/he/subjects/Pages/${indexCode}.aspx`
  const documents = group.date.slice(0, limit).map((entry, index) => makeDocument({
    id: `israel_cbs:${indexCode}:${entry.year}-${entry.month}`,
    provider: PROVIDER,
    providerRecordId: `${indexCode}:${entry.year}-${entry.month}-${index}`,
    title: `${group.name ?? indexCode} — ${entry.monthDesc ?? entry.month}/${entry.year}`,
    summary: entry.currBase?.value != null ? `Index value: ${entry.currBase.value} (${entry.currBase.baseDesc ?? ''})` : null,
    contentSnippet: entry.percent != null ? `MoM change: ${entry.percent}%, YoY: ${entry.percentYear ?? 'n/a'}%` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Israel Central Bureau of Statistics',
    contentType: 'economic_index_point',
    authors: [],
    organization: 'Israel CBS',
    publishedAt: entry.year && entry.month ? `${entry.year}-${String(entry.month).padStart(2, '0')}` : null,
    updatedAt: null,
    geography: 'IL',
    language: 'he',
    identifiers: { israel_cbs_index_code: indexCode },
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
      const outcome = await fetchIndex(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Israel CBS fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?id=${DEFAULT_INDEX}`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'price index endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const israelCbsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
