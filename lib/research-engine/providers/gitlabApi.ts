import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'gitlab_api' as const
const BASE_URL = 'https://gitlab.com/api/v4/projects'
const MAX_RESULTS = 25

type Project = {
  id?: number
  description?: string | null
  name?: string
  path_with_namespace?: string
  created_at?: string
  web_url?: string
  star_count?: number
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a project name/keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `gitlab_api:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('search', text)
  url.searchParams.set('per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Project[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'GitLab API response was not a JSON array.' }
  }

  const documents = data
    .filter(p => typeof p.id === 'number')
    .map(p => {
      const id = String(p.id)
      const canonicalUrl = p.web_url ?? `https://gitlab.com/${p.path_with_namespace}`
      return makeDocument({
        id: `gitlab_api:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: p.path_with_namespace ?? p.name ?? id,
        summary: p.description ?? null,
        contentSnippet: typeof p.star_count === 'number' ? `${p.star_count} stars` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'GitLab',
        contentType: 'code_repository',
        authors: [],
        organization: null,
        publishedAt: p.created_at ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { gitlab_project_id: id },
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
      if (outcome.kind === 'http_error') throw new Error(`GitLab API search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?search=react&per_page=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'projects search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const gitlabApiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
