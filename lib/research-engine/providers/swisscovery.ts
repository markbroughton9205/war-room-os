import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'swisscovery' as const
const BASE_URL = 'https://swisscovery.slsp.ch/primaws/rest/pub/pnxs'
const VID = '41SLSP_NETWORK:VU1_UNION'
const MAX_RESULTS = 25

type Display = { title?: string[]; type?: string[]; language?: string[]; creationdate?: string[]; publisher?: string[]; contributor?: string[]; subject?: string[]; mms?: string[] }
type Doc = { '@id'?: string; pnx?: { display?: Display } }
type SearchResponse = { docs?: Doc[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `swisscovery:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', `any,contains,${text}`)
  url.searchParams.set('vid', VID)
  url.searchParams.set('tab', '41SLSP_NETWORK')
  url.searchParams.set('scope', 'DN_and_CI')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('pcAvailability', 'false')
  url.searchParams.set('offset', '0')
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Swisscovery response "docs" field was missing or not an array.' }
  }

  const documents = data.docs
    .filter(d => d.pnx?.display?.mms?.[0])
    .map(d => {
      const display = d.pnx?.display as Display
      const mms = display.mms?.[0] as string
      const canonicalUrl = `https://swisscovery.slsp.ch/discovery/fulldisplay?docid=alma${mms}&vid=${VID}`
      return makeDocument({
        id: `swisscovery:${mms}`,
        provider: PROVIDER,
        providerRecordId: mms,
        title: display.title?.[0] ?? mms,
        summary: display.publisher?.[0] ?? null,
        contentSnippet: display.type?.[0] ? `Type: ${display.type[0]}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'swisscovery (SLSP Swiss Library Service Platform)',
        contentType: 'library_catalog_record',
        authors: display.contributor ?? [],
        organization: 'SLSP',
        publishedAt: display.creationdate?.[0] ?? null,
        updatedAt: null,
        geography: 'CH',
        language: display.language?.[0] ?? null,
        identifiers: { swisscovery_mms: mms },
        subjects: display.subject ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`Swisscovery search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=any,contains,test&vid=${VID}&tab=41SLSP_NETWORK&scope=DN_and_CI&lang=en&pcAvailability=false&offset=0&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'pnxs search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const swisscoveryAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
