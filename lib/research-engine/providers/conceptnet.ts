import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'conceptnet' as const
const BASE_URL = 'https://api.conceptnet.io'
const MAX_RESULTS = 25
const WORD_PATTERN = /^[a-z0-9_-]{1,50}$/i

type Edge = { rel?: { label?: string }; start?: { label?: string }; end?: { label?: string }; weight?: number }
type ConceptResponse = { edges?: Edge[] }

// Confirmed live this mission: api.conceptnet.io returned HTTP 502 on every
// attempt across multiple retries — a genuine current upstream outage, not
// a transient blip. This adapter is built against the real, documented,
// stable /c/en/{word} contract (unchanged for years) so it recovers
// automatically once ConceptNet's backend is back; healthCheck reports
// honestly rather than claiming readiness it cannot currently prove.
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const word = query.text.trim().toLowerCase().replace(/\s+/g, '_')
  if (!WORD_PATTERN.test(word)) {
    throw new Error('Query must be a single English word or short underscore-joined phrase (e.g. "dog", "climate_change").')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `conceptnet:${word}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/c/en/${word}`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ConceptResponse>(result.text)
  if (!data || !Array.isArray(data.edges)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ConceptNet response "edges" field was missing or not an array.' }
  }

  const canonicalUrl = `https://conceptnet.io/c/en/${word}`
  const documents = data.edges
    .slice(0, limit)
    .map((edge, index) => {
      const rel = edge.rel?.label ?? 'RelatedTo'
      const start = edge.start?.label ?? word
      const end = edge.end?.label ?? ''
      return makeDocument({
        id: `conceptnet:${word}:${index}`,
        provider: PROVIDER,
        providerRecordId: `${word}:${index}`,
        title: `${start} — ${rel} — ${end}`,
        summary: null,
        contentSnippet: typeof edge.weight === 'number' ? `Weight: ${edge.weight}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ConceptNet',
        contentType: 'semantic_relation',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { conceptnet_word: word },
        subjects: [rel],
        license: 'CC-BY-SA',
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
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`ConceptNet lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/c/en/dog`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'concept endpoint reachable' : `HTTP ${result.status} (api.conceptnet.io is a known intermittently-down upstream)`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'degraded', checkedAt: nowIso(), detail: `${error instanceof Error ? error.message : String(error)} (api.conceptnet.io is a known intermittently-down upstream)`, durationMs: Date.now() - started }
  }
}

export const conceptnetAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
