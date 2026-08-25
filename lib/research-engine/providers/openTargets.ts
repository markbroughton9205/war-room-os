import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'open_targets' as const
const BASE_URL = 'https://api.platform.opentargets.org/api/v4/graphql'
const MAX_RESULTS = 20

type SearchHit = { id?: string; name?: string; entity?: string }
type SearchResponse = { data?: { search?: { hits?: SearchHit[] } } }

// Small, fixed GraphQL query shape — no arbitrary caller-supplied GraphQL is
// ever exposed, matching the gnomad/wikidata "no arbitrary query" convention.
function buildQuery(text: string, size: number): string {
  const escaped = text.replace(/"/g, '\\"')
  return JSON.stringify({
    query: `query { search(queryString: "${escaped}", entityNames: ["disease", "target", "drug"], page: { index: 0, size: ${size} }) { hits { id name entity } } }`,
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `open_targets:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'WarRoomResearchEngine/1.0 (research-engine@warroom.local)' },
    body: buildQuery(text, limit),
    timeoutMs: 12_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const hits = data?.data?.search?.hits
  if (!Array.isArray(hits)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Open Targets GraphQL response "data.search.hits" field was missing or not an array.' }
  }

  const documents = hits
    .filter(hit => hit.id && hit.name && hit.entity)
    .map(hit => {
      const canonicalUrl = `https://platform.opentargets.org/${hit.entity}/${hit.id}`
      return makeDocument({
        id: `open_targets:${hit.entity}:${hit.id}`,
        provider: PROVIDER,
        providerRecordId: hit.id as string,
        title: hit.name as string,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Open Targets Platform',
        contentType: `open_targets_${hit.entity}`,
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { open_targets_id: hit.id as string, entity_type: hit.entity as string },
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
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Open Targets GraphQL query failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'WarRoomResearchEngine/1.0 (research-engine@warroom.local)' }, body: buildQuery('asthma', 1), timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'GraphQL endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const openTargetsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
