import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nomis_uk' as const
const BASE_URL = 'https://www.nomisweb.co.uk/api/v01/dataset'
const DATASET_PATTERN = /^NM_\d+_\d+$/i
const DEFAULT_DATASET = 'NM_1_1' // JSA claimant count

type ObsField = { value?: string | number; description?: string }
type Observation = { dataset?: ObsField; geography?: ObsField; time?: ObsField; obs_value?: ObsField; obs_status?: ObsField }
type NomisResponse = { obs?: Observation[] }

/** Query text is a Nomis dataset ID like "NM_1_1"; defaults to JSA claimant count if not recognized. */
function resolveDataset(text: string): string {
  const trimmed = text.trim().toUpperCase()
  return DATASET_PATTERN.test(trimmed) ? trimmed : DEFAULT_DATASET
}

async function fetchDataset(query: ResearchQuery) {
  const started = Date.now()
  const dataset = resolveDataset(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `nomis_uk:${dataset}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${dataset}.data.json`)
  url.searchParams.set('geography', '2092957697') // United Kingdom
  url.searchParams.set('date', 'latest')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<NomisResponse>(result.text)
  if (!data || !Array.isArray(data.obs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Nomis response "obs" field was missing or not an array.' }
  }

  const canonicalUrl = `https://www.nomisweb.co.uk/datasets/${dataset.toLowerCase()}`
  const documents = data.obs.slice(0, limit).map((o, index) => makeDocument({
    id: `nomis_uk:${dataset}:${o.geography?.value}:${o.time?.value}:${index}`,
    provider: PROVIDER,
    providerRecordId: `${dataset}:${index}`,
    title: `${o.dataset?.description ?? dataset} — ${o.geography?.description ?? 'UK'} (${o.time?.description ?? o.time?.value ?? 'latest'})`,
    summary: o.obs_value?.value != null ? `Value: ${o.obs_value.value}` : null,
    contentSnippet: o.obs_status?.description ?? null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Nomis (ONS UK Labour Market Statistics)',
    contentType: 'labour_market_statistic',
    authors: [],
    organization: 'Office for National Statistics (UK)',
    publishedAt: o.time?.value != null ? String(o.time.value) : null,
    updatedAt: null,
    geography: o.geography?.description ?? 'UK',
    language: 'en',
    identifiers: { nomis_dataset: dataset },
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
      const outcome = await fetchDataset(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Nomis UK fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_DATASET}.data.json?geography=2092957697&date=latest`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'dataset endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nomisUkAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
