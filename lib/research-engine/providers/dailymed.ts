import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'dailymed' as const
const BASE_URL = 'https://dailymed.nlm.nih.gov/dailymed/services/v2'
const MAX_RESULTS = 20

type SplEntry = { setid?: string; title?: string; published_date?: string; spl_version?: number }
type SplsResponse = { data?: SplEntry[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `dailymed:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/spls.json`)
  url.searchParams.set('drug_name', text)
  url.searchParams.set('pagesize', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SplsResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'DailyMed response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(entry => entry.setid && entry.title)
    .slice(0, limit)
    .map(entry => {
      const setid = entry.setid as string
      const canonicalUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`
      return makeDocument({
        id: `dailymed:${setid}`,
        provider: PROVIDER,
        providerRecordId: setid,
        title: entry.title as string,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'DailyMed',
        contentType: 'drug_label',
        authors: [],
        organization: 'US National Library of Medicine',
        publishedAt: entry.published_date ?? null,
        updatedAt: null,
        geography: 'US',
        language: 'en',
        identifiers: { dailymed_setid: setid, ...(entry.spl_version ? { spl_version: String(entry.spl_version) } : {}) },
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
      if (outcome.kind === 'http_error') throw new Error(`DailyMed search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/spls.json?drug_name=aspirin&pagesize=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'spls endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const dailymedAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
