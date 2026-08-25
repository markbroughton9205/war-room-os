import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'worms' as const
const BASE_URL = 'https://www.marinespecies.org/rest'
const MAX_RESULTS = 20

type AphiaRecord = {
  AphiaID?: number
  scientificname?: string
  authority?: string
  status?: string
  rank?: string
  kingdom?: string
  phylum?: string
  url?: string
  modified?: string
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `worms:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/AphiaRecordsByName/${encodeURIComponent(text)}?like=true&marine_only=false`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  // WoRMS returns HTTP 204 (no body) for a genuinely empty match set — an
  // honest empty result, not an error.
  if (result.status === 204 || result.status === 404) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<unknown>(result.text)
  // WoRMS documents non-array sentinel values (e.g. -999, null) for certain
  // malformed/ambiguous queries — never fabricated into an empty success;
  // only a genuine array (including []) is treated as a valid response.
  if (!Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: `WoRMS response was not an array (got ${JSON.stringify(parsed).slice(0, 100)}).` }
  }
  const records = parsed as AphiaRecord[]

  const documents = records
    .filter(rec => typeof rec.AphiaID === 'number' && rec.scientificname)
    .slice(0, limit)
    .map(rec => {
      const id = String(rec.AphiaID)
      const canonicalUrl = rec.url ?? `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${id}`
      return makeDocument({
        id: `worms:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: rec.scientificname as string,
        summary: rec.authority ? `Authority: ${rec.authority}` : null,
        contentSnippet: rec.status ? `Status: ${rec.status}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'World Register of Marine Species (WoRMS)',
        contentType: 'species_taxonomy_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: rec.modified ?? null,
        geography: null,
        language: null,
        identifiers: { aphia_id: id, ...(rec.rank ? { taxonomic_rank: rec.rank } : {}) },
        subjects: [rec.kingdom, rec.phylum].filter((s): s is string => Boolean(s)),
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
      if (outcome.kind === 'http_error') throw new Error(`WoRMS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/AphiaRecordsByName/Orcinus%20orca?like=false&marine_only=true`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok || result.status === 204 ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'AphiaRecordsByName reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wormsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
