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

type GithubIssueItem = {
  id: number
  number: number
  title: string
  html_url: string
  body: string | null
  user: { login: string } | null
  repository_url: string | null
  state: string | null
  created_at: string | null
  updated_at: string | null
  closed_at: string | null
  pull_request?: Record<string, unknown>
}

type GithubSearchMode = 'repositories' | 'issues' | 'pull_requests'

type ParsedGithubQuery = {
  mode: GithubSearchMode
  text: string
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

function parseGithubQuery(text: string): ParsedGithubQuery {
  const trimmed = text.trim()
  const issueMatch = /^(?:github\s+)?(?:issues?|issue-search)\s*:\s*(.+)$/i.exec(trimmed)
  if (issueMatch?.[1]?.trim()) return { mode: 'issues', text: issueMatch[1].trim() }

  const pullRequestMatch = /^(?:github\s+)?(?:prs?|pull\s+requests?|pull-request-search)\s*:\s*(.+)$/i.exec(trimmed)
  if (pullRequestMatch?.[1]?.trim()) return { mode: 'pull_requests', text: pullRequestMatch[1].trim() }

  return { mode: 'repositories', text: trimmed }
}

function boundedGithubSearchText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 256)
}

function githubIssueQualifier(mode: GithubSearchMode): string {
  if (mode === 'issues') return 'is:issue'
  if (mode === 'pull_requests') return 'is:pr'
  return ''
}

function issueRepositoryName(repositoryUrl: string | null): string | null {
  if (!repositoryUrl) return null
  try {
    const url = new URL(repositoryUrl)
    const match = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function normalizeIssueSearchQuery(text: string, mode: GithubSearchMode): string {
  const qualifier = githubIssueQualifier(mode)
  if (!qualifier) return boundedGithubSearchText(text)
  const withoutDiscriminators = text.replace(/\b(?:is|type):(?:issue|pr)\b/gi, ' ')
  const bounded = boundedGithubSearchText(withoutDiscriminators)
  return `${bounded} ${qualifier}`.trim()
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const parsed = parseGithubQuery(query.text)
  const cacheKey = `github:search:${parsed.mode}:${parsed.text}:${query.maxResults ?? 10}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const perPage = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const url = new URL(parsed.mode === 'repositories' ? 'https://api.github.com/search/repositories' : 'https://api.github.com/search/issues')
  url.searchParams.set('q', parsed.mode === 'repositories' ? query.text : normalizeIssueSearchQuery(parsed.text, parsed.mode))
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('sort', parsed.mode === 'repositories' ? 'stars' : 'updated')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: authHeaders(), timeoutMs: 12_000 })
  if (!result.ok) {
    return { ok: false as const, status: result.status, durationMs: Date.now() - started }
  }
  const data = safeJsonParse<{ items?: unknown[] }>(result.text)
  const items = data?.items ?? []
  const documents = parsed.mode === 'repositories'
    ? (items as GithubRepoItem[]).filter(item => typeof item.full_name === 'string' && typeof item.html_url === 'string').map(item => makeDocument({
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
    : (items as GithubIssueItem[]).filter(item => typeof item.id === 'number' && typeof item.number === 'number' && typeof item.title === 'string' && typeof item.html_url === 'string').map(item => {
        const repoName = issueRepositoryName(item.repository_url)
        const isPullRequest = Boolean(item.pull_request)
        return makeDocument({
          id: `github:${repoName ?? 'unknown'}#${item.number}`,
          provider: PROVIDER,
          providerRecordId: String(item.id),
          title: repoName ? `${repoName}#${item.number}: ${item.title}` : `GitHub #${item.number}: ${item.title}`,
          summary: item.title,
          contentSnippet: item.body,
          canonicalUrl: item.html_url,
          sourceUrl: item.html_url,
          sourceName: 'GitHub',
          contentType: isPullRequest ? 'code_pull_request' : 'code_issue',
          authors: item.user ? [item.user.login] : [],
          organization: repoName?.split('/')[0] ?? null,
          publishedAt: item.created_at,
          updatedAt: item.updated_at ?? item.closed_at,
          geography: null,
          language: null,
          identifiers: {
            github_issue_id: String(item.id),
            github_issue_number: String(item.number),
            ...(repoName ? { github_repository: repoName } : {}),
            ...(isPullRequest ? { github_pull_request: 'true' } : {}),
          },
          subjects: item.state ? [item.state] : [],
          license: null,
          accessStatus: 'open',
        })
      })
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
