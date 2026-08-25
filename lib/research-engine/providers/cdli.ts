import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cdli' as const
const BASE_URL = 'https://cdli.earth'
const MAX_RESULTS = 25

type ArtifactType = { artifact_type?: string }
type Period = { period?: string }
type Provenience = { provenience?: string }
type Artifact = {
  id?: number | string
  designation?: string
  museum_no?: string
  findspot_comments?: string
  artifact_type?: ArtifactType
  period?: Period
  provenience?: Provenience
}
type SearchResponse = { data?: Artifact[] } | Artifact[]

function extractArtifacts(data: SearchResponse): Artifact[] {
  if (Array.isArray(data)) return data
  return Array.isArray(data.data) ? data.data : []
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `cdli:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search`)
  url.searchParams.set('f[keyword]', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000, headers: { Accept: 'application/json' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CDLI response was not valid JSON.' }
  }
  const artifacts = extractArtifacts(data)

  const documents = artifacts
    .slice(0, limit)
    .filter(a => a.id != null)
    .map(a => {
      const id = String(a.id)
      const canonicalUrl = `https://cdli.earth/artifacts/${id}`
      return makeDocument({
        id: `cdli:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: a.designation ?? a.museum_no ?? `Artifact ${id}`,
        summary: a.provenience?.provenience ? `Provenience: ${a.provenience.provenience}` : null,
        contentSnippet: a.findspot_comments ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Cuneiform Digital Library Initiative',
        contentType: 'cuneiform_artifact',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: a.provenience?.provenience ?? null,
        language: null,
        identifiers: { cdli_id: id, ...(a.museum_no ? { museum_no: a.museum_no } : {}) },
        subjects: [a.artifact_type?.artifact_type, a.period?.period].filter((v): v is string => !!v),
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
      if (outcome.kind === 'http_error') throw new Error(`CDLI search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search?f[keyword]=tablet`, { timeoutMs: 10_000, headers: { Accept: 'application/json' } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cdliAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
