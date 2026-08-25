import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'usgs_m2m' as const
const BASE_URL = 'https://m2m.cronus.usgs.gov/api/api/json/stable'
const DEFAULT_DATASET = 'landsat_ot_c2_l2'

// USGS EarthExplorer Machine-to-Machine (M2M) API requires a real USGS
// EROS account plus an application-token issued after a separate M2M
// access request — a two-step auth flow (login-token -> X-Auth-Token
// header on subsequent calls), confirmed real but credential-blocked; not
// independently exercisable without an approved account this build.
type LoginResponse = { data?: string; errorCode?: string | null; errorMessage?: string | null }
type SceneBrowse = { browsePath?: string }
type Scene = { entityId?: string; displayId?: string; publishDate?: string; browse?: SceneBrowse[]; cloudCover?: number }
type SceneSearchResponse = { data?: { results?: Scene[] }; errorCode?: string | null; errorMessage?: string | null }

function credentials(): { username: string; token: string } {
  return {
    username: process.env.USGS_M2M_USERNAME?.trim() ?? '',
    token: process.env.USGS_M2M_TOKEN?.trim() ?? '',
  }
}

async function login(): Promise<{ ok: true; authToken: string } | { ok: false; status: number }> {
  const { username, token } = credentials()
  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/login-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, token }),
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false, status: result.status }
  const data = safeJsonParse<LoginResponse>(result.text)
  if (!data?.data) return { ok: false, status: result.status }
  return { ok: true, authToken: data.data }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a USGS dataset name (e.g. "landsat_ot_c2_l2") or scene keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 20))
  const cacheKey = `usgs_m2m:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const auth = await login()
  if (!auth.ok) return { ok: false as const, kind: 'http_error' as const, status: auth.status }

  const dataset = /^[a-z0-9_]+$/i.test(text) ? text : DEFAULT_DATASET
  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/scene-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': auth.authToken },
    body: JSON.stringify({ datasetName: dataset, maxResults: limit }),
    timeoutMs: 20_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SceneSearchResponse>(result.text)
  const scenes = data?.data?.results
  if (!Array.isArray(scenes)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'USGS M2M scene-search response "data.results" field was missing or not an array.' }
  }

  const documents = scenes
    .filter(s => typeof s.entityId === 'string')
    .map(s => {
      const id = s.entityId as string
      const canonicalUrl = `https://earthexplorer.usgs.gov/scene/metadata/full/${dataset}/${id}`
      return makeDocument({
        id: `usgs_m2m:${dataset}:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: s.displayId ?? id,
        summary: typeof s.cloudCover === 'number' ? `Cloud cover: ${s.cloudCover}%` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: s.browse?.[0]?.browsePath ?? canonicalUrl,
        sourceName: 'USGS EarthExplorer (M2M)',
        contentType: 'satellite_scene',
        authors: [],
        organization: 'USGS',
        publishedAt: s.publishDate ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { usgs_entity_id: id, usgs_dataset: dataset },
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
    return notConfiguredResponse(PROVIDER, 'USGS_M2M_USERNAME / USGS_M2M_TOKEN are not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`USGS M2M search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'USGS_M2M_USERNAME / USGS_M2M_TOKEN missing', durationMs: null }
  }
  try {
    const auth = await login()
    return { provider: PROVIDER, state: auth.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: auth.ok ? 'login-token succeeded' : `HTTP ${auth.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usgsM2mAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
