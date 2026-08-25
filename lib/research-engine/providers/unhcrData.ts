import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'unhcr_data' as const
const BASE_URL = 'https://api.unhcr.org/population/v1/population/'
const MAX_RESULTS = 25
const ISO3_PATTERN = /^[A-Za-z]{3}$/

type PopulationItem = {
  year?: number
  coo_name?: string
  coo_iso?: string
  coa_name?: string
  coa_iso?: string
  refugees?: number
  asylum_seekers?: number
  idps?: number
  stateless?: number
}
type PopulationResponse = { items?: PopulationItem[] }

/** Query text is a 3-letter ISO country-of-origin code (e.g. "SYR", "UKR"). */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const coo = query.text.trim().toUpperCase()
  if (!ISO3_PATTERN.test(coo)) {
    throw new Error('Query must be a 3-letter ISO country-of-origin code (e.g. "SYR", "UKR", "AFG").')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `unhcr_data:${coo}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('coo', coo)
  url.searchParams.set('limit', String(limit))
  url.searchParams.append('columns[]', 'coo_name')
  url.searchParams.append('columns[]', 'coa_name')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PopulationResponse>(result.text)
  if (!data || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'UNHCR response "items" field was missing or not an array.' }
  }

  const documents = data.items.map((item, index) => {
    const id = `${coo}-${item.coa_iso ?? 'unknown'}-${item.year ?? index}`
    return makeDocument({
      id: `unhcr_data:${id}`,
      provider: PROVIDER,
      providerRecordId: id,
      title: `${item.coo_name ?? coo} → ${item.coa_name ?? 'unknown'} (${item.year ?? 'unknown year'})`,
      summary: `Refugees: ${item.refugees ?? 0}, asylum seekers: ${item.asylum_seekers ?? 0}, IDPs: ${item.idps ?? 0}, stateless: ${item.stateless ?? 0}`,
      contentSnippet: null,
      canonicalUrl: 'https://www.unhcr.org/refugee-statistics/',
      sourceUrl: 'https://www.unhcr.org/refugee-statistics/',
      sourceName: 'UNHCR Refugee Data Finder',
      contentType: 'population_statistic',
      authors: [],
      organization: 'UNHCR',
      publishedAt: item.year ? String(item.year) : null,
      updatedAt: null,
      geography: `${item.coo_name ?? coo} to ${item.coa_name ?? 'unknown'}`,
      language: 'en',
      identifiers: { unhcr_coo: coo, ...(item.coa_iso ? { unhcr_coa: item.coa_iso } : {}), ...(item.year ? { year: String(item.year) } : {}) },
      subjects: ['refugees', 'displacement'],
      license: null,
      accessStatus: 'open',
    })
  })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`UNHCR search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?coo=SYR&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'population endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const unhcrDataAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
