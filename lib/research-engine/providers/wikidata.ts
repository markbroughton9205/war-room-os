import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'wikidata' as const

type WbSearchEntity = { id: string; label?: string; description?: string; url?: string }
type WbSearchResponse = { search?: WbSearchEntity[] }
type WbEntity = { labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims?: Record<string, unknown[]> }
type WbGetEntitiesResponse = { entities?: Record<string, WbEntity> }

function actionApiUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('WIKIDATA_ACTION_API_URL', descriptor)) || 'https://www.wikidata.org/w/api.php'
}

function userAgentHeader(): Record<string, string> {
  const base = process.env.WIKIMEDIA_USER_AGENT_BASE?.trim()
  return base ? { 'User-Agent': base } : {}
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const limit = Math.max(1, Math.min(query.maxResults ?? 5, 10))
  const cacheKey = `wikidata:search:${query.text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const searchUrl = new URL(actionApiUrl())
  searchUrl.searchParams.set('action', 'wbsearchentities')
  searchUrl.searchParams.set('search', query.text)
  searchUrl.searchParams.set('language', 'en')
  searchUrl.searchParams.set('format', 'json')
  searchUrl.searchParams.set('limit', String(limit))

  const searchResult = await safeProviderFetch(PROVIDER, searchUrl.toString(), { headers: userAgentHeader(), timeoutMs: 10_000 })
  if (!searchResult.ok) return { ok: false as const, status: searchResult.status }

  const searchData = safeJsonParse<WbSearchResponse>(searchResult.text)
  const hits = searchData?.search ?? []
  if (hits.length === 0) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }

  const ids = hits.map(hit => hit.id).slice(0, limit)
  const entitiesUrl = new URL(actionApiUrl())
  entitiesUrl.searchParams.set('action', 'wbgetentities')
  entitiesUrl.searchParams.set('ids', ids.join('|'))
  entitiesUrl.searchParams.set('props', 'labels|descriptions|aliases')
  entitiesUrl.searchParams.set('languages', 'en')
  entitiesUrl.searchParams.set('format', 'json')
  const entitiesResult = await safeProviderFetch(PROVIDER, entitiesUrl.toString(), { headers: userAgentHeader(), timeoutMs: 10_000 })
  const entitiesData = entitiesResult.ok ? safeJsonParse<WbGetEntitiesResponse>(entitiesResult.text) : null

  const documents = hits.map(hit => {
    const entity = entitiesData?.entities?.[hit.id]
    const label = entity?.labels?.en?.value ?? hit.label ?? hit.id
    const description = entity?.descriptions?.en?.value ?? hit.description ?? null
    const aliases = (entity?.aliases?.en ?? []).map(alias => alias.value)
    return makeDocument({
      id: `wikidata:${hit.id}`,
      provider: PROVIDER,
      providerRecordId: hit.id,
      title: label,
      summary: description,
      contentSnippet: description,
      canonicalUrl: `https://www.wikidata.org/wiki/${hit.id}`,
      sourceUrl: `https://www.wikidata.org/wiki/${hit.id}`,
      sourceName: 'Wikidata',
      contentType: 'knowledge_graph_entity',
      authors: [],
      organization: 'Wikimedia Foundation',
      publishedAt: null,
      updatedAt: null,
      geography: null,
      language: 'en',
      identifiers: { wikidata_qid: hit.id },
      subjects: aliases,
      license: 'CC0',
      accessStatus: 'open',
      warnings: ['Community-maintained data — not independently verified by War Room.'],
    })
  })

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'WIKIMEDIA_USER_AGENT_BASE is not configured (required by Wikimedia usage policy).')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (!outcome.ok) throw new Error(`Wikidata search failed with HTTP ${outcome.status}`)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'WIKIMEDIA_USER_AGENT_BASE missing', durationMs: null }
  }
  try {
    const url = new URL(actionApiUrl())
    url.searchParams.set('action', 'wbsearchentities')
    url.searchParams.set('search', 'test')
    url.searchParams.set('language', 'en')
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: userAgentHeader(), timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'action API reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wikidataAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
