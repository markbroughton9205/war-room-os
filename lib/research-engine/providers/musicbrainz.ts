import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'musicbrainz' as const
const BASE_URL = 'https://musicbrainz.org/ws/2/artist'
const MAX_RESULTS = 25
// Confirmed live: an empty/missing User-Agent gets a real 403 throttling
// error — MusicBrainz's UA requirement is server-enforced, not a courtesy.
const USER_AGENT = 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)'

type Area = { name?: string }
type LifeSpan = { begin?: string; ended?: boolean }
type Artist = { id?: string; type?: string; name?: string; country?: string; area?: Area; 'life-span'?: LifeSpan }
type SearchResponse = { count?: number; artists?: Artist[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be an artist name.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `musicbrainz:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('query', text)
  url.searchParams.set('fmt', 'json')
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000, headers: { 'User-Agent': USER_AGENT } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.artists)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'MusicBrainz response "artists" field was missing or not an array.' }
  }

  const documents = data.artists
    .filter(a => typeof a.id === 'string')
    .map(a => {
      const id = a.id as string
      const canonicalUrl = `https://musicbrainz.org/artist/${id}`
      return makeDocument({
        id: `musicbrainz:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: a.name ?? id,
        summary: a.type ? `Type: ${a.type}` : null,
        contentSnippet: a['life-span']?.begin ? `Active since ${a['life-span']?.begin}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'MusicBrainz',
        contentType: 'music_artist',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: a.area?.name ?? a.country ?? null,
        language: null,
        identifiers: { musicbrainz_id: id },
        subjects: [],
        license: 'CC0',
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
      if (outcome.kind === 'http_error') throw new Error(`MusicBrainz search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?query=Beatles&fmt=json&limit=1`, { timeoutMs: 10_000, headers: { 'User-Agent': USER_AGENT } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'artist search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const musicbrainzAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
