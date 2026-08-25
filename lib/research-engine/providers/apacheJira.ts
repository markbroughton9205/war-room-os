import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'apache_jira' as const
const BASE_URL = 'https://issues.apache.org/jira/rest/api/2/search'
const MAX_RESULTS = 25
const FIELDS = 'summary,status,project,created,updated,priority'

type Fields = {
  summary?: string
  status?: { name?: string }
  project?: { key?: string; name?: string }
  priority?: { name?: string }
  created?: string
  updated?: string
}
type Issue = { key?: string; fields?: Fields }
type SearchResponse = { issues?: Issue[] }

function escapeJql(value: string): string {
  return value.replace(/["\\]/g, '')
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `apache_jira:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('jql', `text ~ "${escapeJql(text)}"`)
  url.searchParams.set('maxResults', String(limit))
  url.searchParams.set('fields', FIELDS)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.issues)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Apache Jira response "issues" field was missing or not an array.' }
  }

  const documents = data.issues
    .filter(issue => typeof issue.key === 'string')
    .map(issue => {
      const key = issue.key as string
      const fields = issue.fields ?? {}
      const canonicalUrl = `https://issues.apache.org/jira/browse/${key}`
      return makeDocument({
        id: `apache_jira:${key}`,
        provider: PROVIDER,
        providerRecordId: key,
        title: fields.summary ?? key,
        summary: fields.project?.name ?? null,
        contentSnippet: `Status: ${fields.status?.name ?? 'unknown'}${fields.priority?.name ? `, priority: ${fields.priority.name}` : ''}`,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Apache Jira',
        contentType: 'bug_report',
        authors: [],
        organization: 'Apache Software Foundation',
        publishedAt: fields.created ?? null,
        updatedAt: fields.updated ?? null,
        geography: null,
        language: 'en',
        identifiers: { jira_key: key, ...(fields.project?.key ? { project_key: fields.project.key } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Apache Jira search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = new URL(BASE_URL)
    url.searchParams.set('jql', 'text ~ "build"')
    url.searchParams.set('maxResults', '1')
    url.searchParams.set('fields', 'summary')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const apacheJiraAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
