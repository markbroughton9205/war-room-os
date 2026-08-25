import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ebl' as const
const BASE_URL = 'https://www.ebl.lmu.de/api/fragments'
const MUSEUM_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+.\s/-]{0,40}$/

// eBL's list/search endpoint rejects every query-param name tried
// (confirmed live: real 422 "Invalid parameters" for all guesses) — this
// is a getById-only adapter (museum number lookup), not free-text search.
type Fragment = { museumNumber?: string; publication?: string; description?: string; collection?: string }

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const museumNumber = query.text.trim()
  if (!MUSEUM_NUMBER_PATTERN.test(museumNumber)) {
    throw new Error('Query must be a cuneiform fragment museum number (e.g. "K.1").')
  }
  const cacheKey = `ebl:${museumNumber}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${encodeURIComponent(museumNumber)}`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Fragment>(result.text)
  if (!data?.museumNumber) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://www.ebl.lmu.de/fragmentarium/${encodeURIComponent(data.museumNumber)}`
  const documents = [makeDocument({
    id: `ebl:${data.museumNumber}`,
    provider: PROVIDER,
    providerRecordId: data.museumNumber,
    title: data.museumNumber,
    summary: data.description ?? null,
    contentSnippet: data.publication ?? null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'electronic Babylonian Library',
    contentType: 'cuneiform_fragment',
    authors: [],
    organization: 'LMU Munich',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { ebl_museum_number: data.museumNumber },
    subjects: data.collection ? [data.collection] : [],
    license: null,
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
      throw new Error(`eBL lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/K.1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'fragment lookup reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const eblAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
