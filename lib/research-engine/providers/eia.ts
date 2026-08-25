import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'eia' as const
const BASE_URL = 'https://api.eia.gov/v2'
const MAX_RESULTS = 20
const DEFAULT_DATASET_PATH = 'electricity/retail-sales'

type EiaRow = Record<string, string | number | null>
// EIA's own docs describe the wrapper as `{ response: { data: [...] } }`,
// but this was not independently live-confirmed (no valid key available
// during research) — handled defensively for both a `response.data` and a
// bare top-level `data` shape rather than assuming one.
type EiaResponse = { response?: { data?: EiaRow[] }; data?: EiaRow[] }

function apiKey(): string {
  return process.env.EIA_API_KEY?.trim() ?? ''
}

/** Query text is a dataset path, e.g. "electricity/retail-sales"; defaults to that same well-known dataset. */
function resolveDatasetPath(text: string): string {
  const trimmed = text.trim().replace(/^\/+|\/+$/g, '')
  return /^[a-z0-9/-]{3,80}$/i.test(trimmed) ? trimmed : DEFAULT_DATASET_PATH
}

async function fetchData(query: ResearchQuery) {
  const started = Date.now()
  const datasetPath = resolveDatasetPath(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `eia:${datasetPath}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${datasetPath}/data`)
  url.searchParams.set('api_key', apiKey())
  url.searchParams.set('length', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<EiaResponse>(result.text)
  const rows = parsed?.response?.data ?? parsed?.data
  if (!Array.isArray(rows)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'EIA response did not contain a "response.data" or "data" array in either documented wrapper shape.' }
  }

  const canonicalUrl = 'https://www.eia.gov/opendata/'
  const documents = rows.slice(0, limit).map((row, i) => {
    const period = typeof row.period === 'string' ? row.period : null
    return makeDocument({
      id: `eia:${datasetPath}:${period ?? i}`,
      provider: PROVIDER,
      providerRecordId: `${datasetPath}:${period ?? i}`,
      title: `${datasetPath} — ${period ?? 'unknown period'}`,
      summary: JSON.stringify(row).slice(0, 300),
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'US Energy Information Administration',
      contentType: 'energy_statistics_data_point',
      authors: [],
      organization: 'EIA',
      publishedAt: period,
      updatedAt: null,
      geography: 'US',
      language: 'en',
      identifiers: { eia_dataset: datasetPath },
      subjects: [],
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
    return notConfiguredResponse(PROVIDER, 'EIA_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchData(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`EIA data fetch failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'EIA_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_DATASET_PATH}/data?api_key=${encodeURIComponent(apiKey())}&length=1`, { timeoutMs: 10_000 })
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

export const eiaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
