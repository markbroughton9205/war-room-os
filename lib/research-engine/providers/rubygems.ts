import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'rubygems' as const
const BASE_URL = 'https://rubygems.org/api/v1/search.json'
const MAX_RESULTS = 20

type Gem = { name?: string; info?: string; version?: string; authors?: string; licenses?: string[] | null; project_uri?: string; gem_uri?: string }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `rubygems:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('query', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  // RubyGems' search endpoint returns a bare JSON array, not an
  // object-wrapped list — a shape difference from the other package
  // registries in this batch, handled explicitly here.
  const gems = safeJsonParse<Gem[]>(result.text)
  if (!Array.isArray(gems)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'RubyGems response was not a JSON array.' }
  }

  const documents = gems
    .filter(gem => gem.name)
    .slice(0, limit)
    .map(gem => {
      const name = gem.name as string
      const canonicalUrl = gem.project_uri ?? `https://rubygems.org/gems/${name}`
      return makeDocument({
        id: `rubygems:${name}`,
        provider: PROVIDER,
        providerRecordId: name,
        title: name,
        summary: gem.info ?? null,
        contentSnippet: gem.version ? `Latest version: ${gem.version}` : null,
        canonicalUrl,
        sourceUrl: gem.gem_uri ?? canonicalUrl,
        sourceName: 'RubyGems.org',
        contentType: 'software_package',
        authors: gem.authors ? gem.authors.split(',').map(a => a.trim()).filter(Boolean) : [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { rubygems_name: name, ...(gem.version ? { latest_version: gem.version } : {}) },
        subjects: [],
        license: Array.isArray(gem.licenses) ? gem.licenses.join(', ') || null : null,
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
      if (outcome.kind === 'http_error') throw new Error(`RubyGems search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?query=rails`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const rubygemsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
