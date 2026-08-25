import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'smk' as const
const BASE_URL = 'https://api.smk.dk/api/v1'
const MAX_RESULTS = 25

type Title = { title?: string; language?: string }
type Production = { creator?: string }
type Item = {
  id?: string
  object_number?: string
  titles?: Title[]
  object_url?: string
  frontend_url?: string
  production?: Production[]
  public_domain?: boolean
}
type SearchResponse = { items?: Item[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `smk:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/art/search/`)
  url.searchParams.set('keys', text)
  url.searchParams.set('rows', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SMK response "items" field was missing or not an array.' }
  }

  const documents = data.items
    .filter(item => typeof item.id === 'string')
    .map(item => {
      const id = item.id as string
      const canonicalUrl = item.frontend_url ?? item.object_url ?? `https://open.smk.dk/en/artwork/image/${id}`
      const title = item.titles?.[0]?.title ?? `Artwork ${id}`
      const creators = (item.production ?? []).map(p => p.creator).filter((v): v is string => !!v)
      return makeDocument({
        id: `smk:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title,
        summary: creators.length ? creators.join('; ') : null,
        contentSnippet: item.object_number ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'SMK (National Gallery of Denmark)',
        contentType: 'museum_artwork',
        authors: creators,
        organization: 'Statens Museum for Kunst',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: item.titles?.[0]?.language ?? null,
        identifiers: { smk_id: id, ...(item.object_number ? { object_number: item.object_number } : {}) },
        subjects: [],
        license: item.public_domain ? 'Public Domain' : null,
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
      if (outcome.kind === 'http_error') throw new Error(`SMK search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/art/search/?keys=hammershoi&rows=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const smkAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
