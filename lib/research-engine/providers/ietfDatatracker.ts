import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ietf_datatracker' as const
const BASE_URL = 'https://datatracker.ietf.org/api/v1/doc/document/'
const MAX_RESULTS = 25
const RFC_OR_DRAFT_PATTERN = /^(rfc\d+|draft-\S+)$/i

type DocObject = {
  name?: string
  title?: string
  abstract?: string
  rev?: string
  rfc?: number | null
  time?: string
}
type DocResponse = { objects?: DocObject[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be an RFC/draft name (e.g. "rfc8259") or search text.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ietf_datatracker:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  if (RFC_OR_DRAFT_PATTERN.test(text)) {
    url.searchParams.set('name', text.toLowerCase())
  } else {
    url.searchParams.set('title__icontains', text)
  }
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<DocResponse>(result.text)
  if (!data || !Array.isArray(data.objects)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'IETF Datatracker response "objects" field was missing or not an array.' }
  }

  const documents = data.objects
    .filter(doc => typeof doc.name === 'string')
    .map(doc => {
      const name = doc.name as string
      const canonicalUrl = `https://datatracker.ietf.org/doc/${name}/`
      return makeDocument({
        id: `ietf_datatracker:${name}`,
        provider: PROVIDER,
        providerRecordId: name,
        title: doc.title ?? name,
        summary: doc.abstract ? doc.abstract.slice(0, 500) : null,
        contentSnippet: doc.rev ? `Revision: ${doc.rev}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'IETF Datatracker',
        contentType: doc.rfc ? 'rfc' : 'internet_draft',
        authors: [],
        organization: 'IETF',
        publishedAt: doc.time ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { ietf_name: name, ...(doc.rfc ? { rfc_number: String(doc.rfc) } : {}) },
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
      if (outcome.kind === 'http_error') throw new Error(`IETF Datatracker search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?name=rfc8259&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'document endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ietfDatatrackerAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
