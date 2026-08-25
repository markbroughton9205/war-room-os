import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'open_context' as const
const BASE_URL = 'https://opencontext.org/query/.json'
const MAX_RESULTS = 25

type Item = {
  label?: string
  uri?: string
  href?: string
  'project label'?: string
  'context label'?: string
  'item category'?: string
  snippet?: string
  published?: string
  updated?: string
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `open_context:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('response', 'uri-meta')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Item[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Open Context response was not a JSON array.' }
  }

  const documents = data
    .slice(0, limit)
    .filter(item => typeof item.uri === 'string')
    .map(item => {
      const uri = item.uri as string
      const canonicalUrl = item.href ?? uri
      const snippet = item.snippet ? item.snippet.replace(/<\/?mark>/g, '') : null
      return makeDocument({
        id: `open_context:${uri}`,
        provider: PROVIDER,
        providerRecordId: uri,
        title: item.label ?? uri,
        summary: snippet,
        contentSnippet: item['item category'] ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Open Context',
        contentType: 'archaeology_record',
        authors: [],
        organization: item['project label'] ?? null,
        publishedAt: item.published ?? null,
        updatedAt: item.updated ?? null,
        geography: item['context label'] ?? null,
        language: 'en',
        identifiers: { open_context_uri: uri },
        subjects: item['item category'] ? [item['item category']] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`Open Context search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=pottery&response=uri-meta`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'query endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const openContextAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
