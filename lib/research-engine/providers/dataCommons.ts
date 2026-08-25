import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'data_commons' as const
const BASE_URL = 'https://api.datacommons.org/v2/node'

type NodeResponse = { data?: Record<string, { arcs?: Record<string, { nodes?: { name?: string; value?: string }[] }> }> }

function apiKey(): string {
  return process.env.DATA_COMMONS_API_KEY?.trim() ?? ''
}

/**
 * Confirmed live docs (this mission): GET /v2/node resolves a known DCID
 * (Data Commons ID, e.g. "geoId/06085" or "Count_Person") to its property
 * graph — there is no free-text place/entity search in the v2 REST surface,
 * only DCID-scoped node lookup. Query text is therefore treated as a DCID
 * (getById), not a search string.
 */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const dcid = query.text.trim().slice(0, 200)
  if (!dcid) throw new Error('Query must be a Data Commons DCID, e.g. "geoId/06085" or "Count_Person".')
  const cacheKey = `data_commons:${dcid}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('key', apiKey())
  url.searchParams.set('nodes', dcid)
  url.searchParams.set('property', '->[name, typeOf, description]')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<NodeResponse>(result.text)
  const arcs = data?.data?.[dcid]?.arcs
  if (!arcs) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }

  const name = arcs.name?.nodes?.[0]?.value ?? arcs.name?.nodes?.[0]?.name ?? dcid
  const typeOf = arcs.typeOf?.nodes?.map(n => n.name ?? n.value).filter((v): v is string => Boolean(v)) ?? []
  const description = arcs.description?.nodes?.[0]?.value ?? null
  const canonicalUrl = `https://datacommons.org/browser/${dcid}`
  const documents = [makeDocument({
    id: `data_commons:${dcid}`,
    provider: PROVIDER,
    providerRecordId: dcid,
    title: name,
    summary: description,
    contentSnippet: typeOf.join(', ') || null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Data Commons',
    contentType: 'statistical_entity',
    authors: [],
    organization: 'Google Data Commons',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { dcid },
    subjects: typeOf,
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'DATA_COMMONS_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Data Commons node lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'DATA_COMMONS_API_KEY missing', durationMs: null }
  }
  try {
    const url = new URL(BASE_URL)
    url.searchParams.set('key', apiKey())
    url.searchParams.set('nodes', 'Count_Person')
    url.searchParams.set('property', '->name')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'node endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const dataCommonsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
