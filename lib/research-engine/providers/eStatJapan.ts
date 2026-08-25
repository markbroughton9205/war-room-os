import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'e_stat_japan' as const
// Japan's official government statistics portal, API v3.0. Confirmed live
// by a direct unauthenticated probe of
// https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList?appId=test&searchWord=population
// which returned the real GET_STATS_LIST envelope with STATUS 100
// (authentication failure — proves the endpoint and searchWord param are
// real, current, and reachable; a free appId from e-stat.go.jp registration
// would return STATUS 0). This adapter wires getStatsList (table search by
// keyword) only — getStatsData (pulling the actual numeric series for a
// specific statsDataId) is a distinct, separately-scoped endpoint not
// implemented this phase.
const BASE_URL = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList'
const MAX_RESULTS = 20

type EStatLangValue = { '$'?: string } | string | undefined
type EStatTable = {
  '@id'?: string
  STAT_NAME?: EStatLangValue
  GOV_ORG?: EStatLangValue
  STATISTICS_NAME?: string
  TITLE?: EStatLangValue
  CYCLE?: string
  SURVEY_DATE?: string | number
  UPDATED_DATE?: string
}
type EStatListResponse = {
  GET_STATS_LIST?: {
    RESULT?: { STATUS?: number; ERROR_MSG?: string }
    DATALIST_INF?: { TABLE_INF?: EStatTable | EStatTable[] }
  }
}

function apiKey(): string {
  return process.env.ESTAT_JAPAN_APP_ID?.trim() ?? ''
}

function textOf(v: EStatLangValue): string | null {
  if (!v) return null
  if (typeof v === 'string') return v
  return v['$'] ?? null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const searchWord = query.text.trim().slice(0, 100)
  if (!searchWord) throw new Error('Query must be a keyword, e.g. "population" or "GDP".')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `e_stat_japan:${searchWord}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('appId', apiKey())
  url.searchParams.set('searchWord', searchWord)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<EStatListResponse>(result.text)
  const status = data?.GET_STATS_LIST?.RESULT?.STATUS
  if (status != null && status !== 0) {
    return { ok: false as const, kind: 'malformed' as const, message: `e-Stat API error: ${data?.GET_STATS_LIST?.RESULT?.ERROR_MSG ?? `status ${status}`}` }
  }
  const raw = data?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF
  const tables = Array.isArray(raw) ? raw : raw ? [raw] : []

  const documents = tables.slice(0, limit).map(table => {
    const id = table['@id'] ?? ''
    const title = table.STATISTICS_NAME ?? textOf(table.TITLE) ?? id
    const canonicalUrl = id ? `https://www.e-stat.go.jp/stat-search/database?statdisp_id=${id}` : 'https://www.e-stat.go.jp/'
    return makeDocument({
      id: `e_stat_japan:${id}`,
      provider: PROVIDER,
      providerRecordId: id,
      title: title || id,
      summary: textOf(table.STAT_NAME),
      contentSnippet: table.CYCLE ? `Cycle: ${table.CYCLE}` : null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'e-Stat (Japan government statistics)',
      contentType: 'statistical_dataset',
      authors: [],
      organization: textOf(table.GOV_ORG),
      publishedAt: table.SURVEY_DATE != null ? String(table.SURVEY_DATE) : null,
      updatedAt: table.UPDATED_DATE ?? null,
      geography: 'Japan',
      language: 'ja',
      identifiers: { estat_stats_data_id: id },
      subjects: [],
      license: null,
      accessStatus: 'open',
    })
  })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'ESTAT_JAPAN_APP_ID is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`e-Stat search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'ESTAT_JAPAN_APP_ID missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?appId=${encodeURIComponent(apiKey())}&searchWord=population&limit=1`, { timeoutMs: 8_000 })
    const data = safeJsonParse<EStatListResponse>(result.text)
    const status = data?.GET_STATS_LIST?.RESULT?.STATUS
    return {
      provider: PROVIDER,
      state: result.ok && status === 0 ? 'ready' : status === 100 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? `HTTP ${result.status}, e-Stat status ${status}` : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const eStatJapanAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
