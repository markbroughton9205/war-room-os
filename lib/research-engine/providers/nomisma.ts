import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nomisma' as const
const BASE_URL = 'https://www.nomisma.org/id'
const ID_PATTERN = /^[a-z0-9_.-]{1,100}$/i

// Nomisma has no free-text search API — only content-negotiated JSON per
// concept URI (confirmed live: https://www.nomisma.org/id/{id}.json).
// Query text is expected to be a nomisma concept slug (e.g. "denarius").
// Confirmed live this mission: the server is real but intermittently
// unreachable (repeated TLS handshake hangs across ~10 attempts, one clean
// round-trip) — a genuine upstream reliability issue, not an adapter defect.
// A generous timeout is used and healthCheck reports honestly rather than
// claiming steady-state readiness it cannot currently prove.

type NomismaConcept = {
  '@id'?: string
  label?: string | { '@value'?: string }[]
  hasCollection?: unknown
}

function labelOf(concept: NomismaConcept, fallback: string): string {
  if (typeof concept.label === 'string') return concept.label
  if (Array.isArray(concept.label) && concept.label[0]?.['@value']) return concept.label[0]['@value'] as string
  return fallback
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const id = query.text.trim().toLowerCase()
  if (!ID_PATTERN.test(id)) {
    throw new Error('Query must be a Nomisma concept slug (e.g. "denarius", "as", "sestertius") — Nomisma has no free-text search API.')
  }
  const cacheKey = `nomisma:${id}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${id}.json`, { timeoutMs: 20_000, headers: { Accept: 'application/json' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<NomismaConcept>(result.text)
  if (!data) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Nomisma response was not valid JSON.' }
  }

  const canonicalUrl = `https://nomisma.org/id/${id}`
  const documents = [makeDocument({
    id: `nomisma:${id}`,
    provider: PROVIDER,
    providerRecordId: id,
    title: labelOf(data, id),
    summary: null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Nomisma.org',
    contentType: 'numismatic_concept',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { nomisma_id: id },
    subjects: [],
    license: 'CC-BY',
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
      if (outcome.kind === 'http_error') throw new Error(`Nomisma lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/denarius.json`, { timeoutMs: 15_000, headers: { Accept: 'application/json' } })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'concept JSON endpoint reachable' : `HTTP ${result.status} (nomisma.org is a known intermittently-unreachable upstream)`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'degraded', checkedAt: nowIso(), detail: `${error instanceof Error ? error.message : String(error)} (nomisma.org is a known intermittently-unreachable upstream)`, durationMs: Date.now() - started }
  }
}

export const nomismaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
