import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'noaa_cdo' as const
const BASE_URL = 'https://www.ncei.noaa.gov/cdo-web/api/v2'
const MAX_RESULTS = 20
const DEFAULT_DATASET = 'GHCND' // Daily summaries, the broadest/most common dataset

type Dataset = { id?: string; name?: string; mindate?: string; maxdate?: string; datacoverage?: number }
type ListResponse = { results?: Dataset[] }

function token(): string {
  return process.env.NOAA_CDO_TOKEN?.trim() ?? ''
}

/** Query text is a dataset id (e.g. "GHCND"), or "datasets" to list available datasets. */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `noaa_cdo:datasets:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/datasets`)
  url.searchParams.set('limit', String(limit))
  if (text && text.toLowerCase() !== 'datasets') url.searchParams.set('id', text.toUpperCase())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { token: token() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ListResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NOAA CDO response "results" field was missing or not an array.' }
  }

  const canonicalUrl = 'https://www.ncei.noaa.gov/cdo-web/'
  const documents = data.results
    .filter(ds => ds.id && ds.name)
    .map(ds => makeDocument({
      id: `noaa_cdo:${ds.id}`,
      provider: PROVIDER,
      providerRecordId: ds.id as string,
      title: ds.name as string,
      summary: ds.mindate && ds.maxdate ? `Coverage: ${ds.mindate} to ${ds.maxdate}` : null,
      contentSnippet: typeof ds.datacoverage === 'number' ? `Data coverage: ${(ds.datacoverage * 100).toFixed(0)}%` : null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'NOAA NCEI Climate Data Online',
      contentType: 'climate_dataset',
      authors: [],
      organization: 'NOAA',
      publishedAt: ds.mindate ?? null,
      updatedAt: ds.maxdate ?? null,
      geography: null,
      language: 'en',
      identifiers: { noaa_cdo_dataset_id: ds.id as string },
      subjects: [],
      license: null,
      accessStatus: 'open',
    }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.codelist)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'NOAA_CDO_TOKEN is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NOAA CDO fetch failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'NOAA_CDO_TOKEN missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/datasets?id=${DEFAULT_DATASET}&limit=1`, { headers: { token: token() }, timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 400 || result.status === 401 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'datasets endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const noaaCdoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
