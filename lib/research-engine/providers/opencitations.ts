import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'opencitations' as const
// opencitations.net 301-redirects here — the final host is used directly
// rather than following the redirect, avoiding a dependency on this
// provider's redirect-following config.
const BASE_URL = 'https://api.opencitations.net/index/v2/citation-count'

type CountResponse = { count?: string }[]

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const doi = query.text.trim().replace(/^doi:/i, '').slice(0, 200)
  if (!doi) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `opencitations:${doi}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/doi:${encodeURIComponent(doi)}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CountResponse>(result.text)
  if (!Array.isArray(data) || data.length === 0 || typeof data[0].count !== 'string') {
    return { ok: false as const, kind: 'malformed' as const, message: 'OpenCitations response was not a valid single-element citation-count array.' }
  }

  const count = Number(data[0].count)
  const canonicalUrl = `https://doi.org/${doi}`
  const documents = [makeDocument({
    id: `opencitations:${doi}`,
    provider: PROVIDER,
    providerRecordId: doi,
    title: `Citation count for ${doi}`,
    summary: Number.isFinite(count) ? `Cited by ${count} works` : null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'OpenCitations Index',
    contentType: 'citation_count_record',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { doi, ...(Number.isFinite(count) ? { citation_count: String(count) } : {}) },
    subjects: [],
    license: 'CC0',
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`OpenCitations lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/doi:10.1038/nature12373`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'citation-count endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const opencitationsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
