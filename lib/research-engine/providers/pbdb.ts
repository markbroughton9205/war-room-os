import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'pbdb' as const
const BASE_URL = 'https://paleobiodb.org/data1.2/occs/list.json'
const MAX_RESULTS = 25

// Field codes are PBDB's real compact API vocabulary (confirmed live), not
// abbreviated for brevity here: oid=occurrence id, tna=taxonomic name,
// oei=early interval, eag/lag=early/late age (Ma).
type Occurrence = { oid?: string; tna?: string; oei?: string; eag?: number; lag?: number }
type OccsResponse = { records?: Occurrence[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a taxon name (e.g. "Tyrannosaurus").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `pbdb:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('base_name', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OccsResponse>(result.text)
  if (!data || !Array.isArray(data.records)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = data.records
    .filter(occ => typeof occ.oid === 'string')
    .map(occ => {
      const oid = occ.oid as string
      const numericId = oid.replace(/^occ:/, '')
      const canonicalUrl = `https://paleobiodb.org/classic/basicCollectionSearch?occurrence_no=${numericId}`
      const ageRange = occ.eag != null || occ.lag != null ? `${occ.eag ?? '?'}–${occ.lag ?? '?'} Ma` : null
      return makeDocument({
        id: `pbdb:${oid}`,
        provider: PROVIDER,
        providerRecordId: oid,
        title: occ.tna ?? oid,
        summary: occ.oei ? `Interval: ${occ.oei}` : null,
        contentSnippet: ageRange,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Paleobiology Database',
        contentType: 'fossil_occurrence',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { pbdb_occurrence_id: oid },
        subjects: occ.oei ? [occ.oei] : [],
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
      throw new Error(`PBDB search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?base_name=Tyrannosaurus&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'occurrences endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const pbdbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
