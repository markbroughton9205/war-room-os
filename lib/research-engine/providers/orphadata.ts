import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'orphadata' as const
const BASE_URL = 'https://api.orphadata.com/rd-cross-referencing/orphacodes/names'

type ExternalReference = { Reference?: string; Source?: string }
type SummaryInfo = { Definition?: string }
type Results = {
  ORPHAcode?: number | string
  'Preferred term'?: string
  OrphanetURL?: string
  DisorderGroup?: { label?: string } | string
  ExternalReference?: ExternalReference[]
  SummaryInformation?: SummaryInfo[]
  Synonym?: string[]
}
type OrphadataResponse = { data?: { results?: Results } }

/** Orphadata is a name-based lookup returning one best-matched disorder,
 * not a multi-result list (confirmed live). */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const term = query.text.trim().slice(0, 200)
  if (!term) throw new Error('Query must be a rare-disease name (e.g. "Marfan syndrome").')
  const cacheKey = `orphadata:${term}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${encodeURIComponent(term)}`)
  url.searchParams.set('lang', 'en')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OrphadataResponse>(result.text)
  const disorder = data?.data?.results
  if (!disorder?.ORPHAcode) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const orphaCode = String(disorder.ORPHAcode)
  const canonicalUrl = disorder.OrphanetURL ?? `https://www.orpha.net/en/disease/detail/${orphaCode}`
  const groupLabel = typeof disorder.DisorderGroup === 'string' ? disorder.DisorderGroup : disorder.DisorderGroup?.label
  const documents = [makeDocument({
    id: `orphadata:${orphaCode}`,
    provider: PROVIDER,
    providerRecordId: orphaCode,
    title: disorder['Preferred term'] ?? `ORPHA:${orphaCode}`,
    summary: disorder.SummaryInformation?.[0]?.Definition ?? null,
    contentSnippet: groupLabel ?? null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Orphadata (Orphanet)',
    contentType: 'rare_disease_record',
    authors: [],
    organization: 'Orphanet',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { orpha_code: orphaCode },
    subjects: disorder.Synonym?.slice(0, 10) ?? [],
    license: 'CC-BY-4.0',
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
      throw new Error(`Orphadata lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/Marfan%20syndrome?lang=en`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'names endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const orphadataAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
