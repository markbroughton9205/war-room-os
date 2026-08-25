import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { extractXmlBlocks, extractXmlText } from '@/lib/research-engine/security/xmlLite'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'econstor' as const
// ZBW's open-access economics working-paper repository. Standard OAI-PMH
// 2.0 interface, confirmed live and unauthenticated via a direct probe of
// https://www.econstor.eu/oai/request?verb=ListRecords&metadataPrefix=oai_dc
// (real oai_dc records with dc:title/creator/description/subject/date/
// identifier returned). OAI-PMH is a harvesting protocol, not a search
// API — there is no server-side keyword search — so this adapter fetches
// one bounded ListRecords page (no resumptionToken following) and filters
// by title/subject client-side, the same constraint pattern already used
// by the congress_gov adapter for its non-searchable list endpoint.
const BASE_URL = 'https://www.econstor.eu/oai/request'
const MAX_RESULTS = 20

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a keyword to filter recent EconStor working papers by title/subject.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `econstor:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('verb', 'ListRecords')
  url.searchParams.set('metadataPrefix', 'oai_dc')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const records = extractXmlBlocks(result.text, 'record')
  const needle = text.toLowerCase()
  const documents = records
    .map(record => {
      const identifier = extractXmlText(record, 'identifier') ?? ''
      const title = extractXmlText(record, 'dc:title') ?? ''
      const creator = extractXmlText(record, 'dc:creator')
      const description = extractXmlText(record, 'dc:description')
      const date = extractXmlText(record, 'dc:date')
      const language = extractXmlText(record, 'dc:language')
      const handleUrl = extractXmlBlocks(record, 'dc:identifier').map(b => decodeMinimal(b)).find(v => v.startsWith('http://hdl.handle.net/') || v.startsWith('https://hdl.handle.net/')) ?? null
      return { identifier, title, creator, description, date, language, handleUrl }
    })
    .filter(r => r.title && (r.title.toLowerCase().includes(needle) || (r.description ?? '').toLowerCase().includes(needle)))
    .slice(0, limit)
    .map(r => {
      const canonicalUrl = r.handleUrl ?? `https://www.econstor.eu/handle/${r.identifier.replace(/^oai:econstor\.eu:/, '')}`
      return makeDocument({
        id: `econstor:${r.identifier}`,
        provider: PROVIDER,
        providerRecordId: r.identifier,
        title: r.title,
        summary: r.description,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'EconStor',
        contentType: 'working_paper',
        authors: r.creator ? [r.creator] : [],
        organization: 'ZBW Leibniz Information Centre for Economics',
        publishedAt: r.date ?? null,
        updatedAt: null,
        geography: null,
        language: r.language ?? 'en',
        identifiers: { econstor_oai_identifier: r.identifier },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

function decodeMinimal(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`EconStor OAI-PMH query failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?verb=Identify`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'OAI-PMH Identify reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const econstorAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
