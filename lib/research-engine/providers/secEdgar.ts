import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'sec_edgar' as const
const SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index'
const MAX_RESULTS = 20

type EdgarHit = { _id?: string; _source?: { cik?: string; display_names?: string[]; file_type?: string; file_date?: string; root_form?: string; adsh?: string } }
type EdgarSearchResponse = { hits?: { total?: { value?: number }; hits?: EdgarHit[] } }

function userAgent(): string {
  const base = process.env.SEC_EDGAR_USER_AGENT_BASE?.trim()
  return base || ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `sec_edgar:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(SEARCH_URL)
  url.searchParams.set('q', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<EdgarSearchResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.hits?.hits)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SEC EDGAR response "hits.hits" field was missing or not an array.' }
  }

  const documents = data.hits!.hits!
    .slice(0, limit)
    .filter(hit => hit._source?.adsh && hit._source?.cik)
    .map(hit => {
      const source = hit._source!
      const accession = source.adsh as string
      const accessionNoDashes = accession.replace(/-/g, '')
      const cik = String(source.cik).replace(/^0+/, '') || '0'
      const canonicalUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${encodeURIComponent(source.root_form ?? '')}`
      return makeDocument({
        id: `sec_edgar:${accession}`,
        provider: PROVIDER,
        providerRecordId: accession,
        title: `${source.display_names?.[0] ?? `CIK ${cik}`} — ${source.root_form ?? 'filing'} (${accession})`,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/`,
        sourceName: 'SEC EDGAR',
        contentType: 'sec_filing',
        authors: source.display_names ?? [],
        organization: source.display_names?.[0] ?? null,
        publishedAt: source.file_date ?? null,
        updatedAt: null,
        geography: 'US',
        language: 'en',
        identifiers: { sec_accession_number: accession, sec_cik: cik, ...(source.root_form ? { sec_form_type: source.root_form } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'SEC_EDGAR_USER_AGENT_BASE is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`SEC EDGAR search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'SEC_EDGAR_USER_AGENT_BASE missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${SEARCH_URL}?q=apple`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : result.status === 403 ? 'authentication_failed' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const secEdgarAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
