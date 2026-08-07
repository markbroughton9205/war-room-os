import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'github' as const

type GithubRepoItem = {
  full_name: string
  html_url: string
  description: string | null
  owner: { login: string } | null
  language: string | null
  license: { name: string } | null
  stargazers_count: number
  pushed_at: string | null
  updated_at: string | null
  created_at: string | null
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim()
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'WarRoomResearchEngine/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const cacheKey = `github:search:${query.text}:${query.maxResults ?? 10}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const perPage = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', query.text)
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('sort', 'stars')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: authHeaders(), timeoutMs: 12_000 })
  if (!result.ok) {
    return { ok: false as const, status: result.status, durationMs: Date.now() - started }
  }
  const data = safeJsonParse<{ items?: GithubRepoItem[] }>(result.text)
  const items = data?.items ?? []
  const documents = items.map(item => makeDocument({
    id: `github:${item.full_name}`,
    provider: PROVIDER,
    providerRecordId: item.full_name,
    title: item.full_name,
    summary: item.description,
    contentSnippet: item.description,
    canonicalUrl: item.html_url,
    sourceUrl: item.html_url,
    sourceName: 'GitHub',
    contentType: 'code_repository',
    authors: item.owner ? [item.owner.login] : [],
    organization: item.owner?.login ?? null,
    publishedAt: item.created_at,
    updatedAt: item.pushed_at ?? item.updated_at,
    geography: null,
    language: item.language,
    identifiers: { github_full_name: item.full_name },
    subjects: [],
    license: item.license?.name ?? null,
    accessStatus: 'open',
  }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'GITHUB_TOKEN is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (!outcome.ok) {
        throw new Error(`GitHub search failed with HTTP ${outcome.status}`)
      }
      return outcome.response
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message, httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'GITHUB_TOKEN missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, 'https://api.github.com/rate_limit', { headers: authHeaders(), timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 ? 'authentication_failed' : result.status === 403 ? 'rate_limited' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'rate_limit endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const githubAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
