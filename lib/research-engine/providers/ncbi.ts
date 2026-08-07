import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { extractXmlText } from '@/lib/research-engine/security/xmlLite'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ncbi' as const

type EsearchResponse = { esearchresult?: { idlist?: string[] } }
type EsummaryDoc = { uid: string; title: string; pubdate: string; authors?: { name: string }[]; fulljournalname?: string; articleids?: { idtype: string; value: string }[] }
type EsummaryResponse = { result?: Record<string, EsummaryDoc> & { uids?: string[] } }

// NCBI has no Commander-configurable base-URL env var in the inventory — this
// is a stable official host used as an internal default (see hostAllowlist.ts).
function baseUrl(): string {
  return 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
}

function apiKeyParam(url: URL): void {
  const key = process.env.NCBI_API_KEY?.trim()
  if (key) url.searchParams.set('api_key', key)
}

function identifierFor(doc: EsummaryDoc, idtype: string): string | null {
  return doc.articleids?.find(article => article.idtype === idtype)?.value ?? null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const retmax = Math.max(1, Math.min(query.maxResults ?? 10, 20))
  const cacheKey = `ncbi:search:${query.text}:${retmax}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const searchUrl = new URL(`${baseUrl()}/esearch.fcgi`)
  searchUrl.searchParams.set('db', 'pubmed')
  searchUrl.searchParams.set('term', query.text)
  searchUrl.searchParams.set('retmode', 'json')
  searchUrl.searchParams.set('retmax', String(retmax))
  apiKeyParam(searchUrl)

  const searchResult = await safeProviderFetch(PROVIDER, searchUrl.toString(), { timeoutMs: 12_000 })
  if (!searchResult.ok) return { ok: false as const, status: searchResult.status }
  const searchData = safeJsonParse<EsearchResponse>(searchResult.text)
  const ids = searchData?.esearchresult?.idlist ?? []
  if (ids.length === 0) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }

  const summaryUrl = new URL(`${baseUrl()}/esummary.fcgi`)
  summaryUrl.searchParams.set('db', 'pubmed')
  summaryUrl.searchParams.set('id', ids.join(','))
  summaryUrl.searchParams.set('retmode', 'json')
  apiKeyParam(summaryUrl)
  const summaryResult = await safeProviderFetch(PROVIDER, summaryUrl.toString(), { timeoutMs: 12_000 })
  if (!summaryResult.ok) return { ok: false as const, status: summaryResult.status }
  const summaryData = safeJsonParse<EsummaryResponse>(summaryResult.text)

  // Fetch the abstract (XML) for only the top result to demonstrate the XML path without hammering E-utilities.
  let topAbstract: string | null = null
  if (ids[0]) {
    const efetchUrl = new URL(`${baseUrl()}/efetch.fcgi`)
    efetchUrl.searchParams.set('db', 'pubmed')
    efetchUrl.searchParams.set('id', ids[0])
    efetchUrl.searchParams.set('rettype', 'abstract')
    efetchUrl.searchParams.set('retmode', 'xml')
    apiKeyParam(efetchUrl)
    const efetchResult = await safeProviderFetch(PROVIDER, efetchUrl.toString(), { timeoutMs: 12_000 })
    if (efetchResult.ok) topAbstract = extractXmlText(efetchResult.text, 'AbstractText')
  }

  const documents = ids
    .map(id => summaryData?.result?.[id])
    .filter((doc): doc is EsummaryDoc => Boolean(doc))
    .map(doc => {
      const pmcid = identifierFor(doc, 'pmc')
      const doi = identifierFor(doc, 'doi')
      return makeDocument({
        id: `ncbi:pmid:${doc.uid}`,
        provider: PROVIDER,
        providerRecordId: doc.uid,
        title: doc.title,
        summary: doc.uid === ids[0] ? topAbstract : null,
        contentSnippet: doc.uid === ids[0] ? topAbstract : null,
        canonicalUrl: `https://pubmed.ncbi.nlm.nih.gov/${doc.uid}/`,
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${doc.uid}/`,
        sourceName: doc.fulljournalname ?? 'PubMed',
        contentType: 'biomedical_literature',
        authors: (doc.authors ?? []).map(author => author.name),
        organization: null,
        publishedAt: doc.pubdate,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { pmid: doc.uid, ...(pmcid ? { pmcid } : {}), ...(doi ? { doi } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'unknown',
        warnings: ['Not medical advice; abstract text only, not a clinical recommendation.'],
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
      if (!outcome.ok) throw new Error(`NCBI search failed with HTTP ${outcome.status}`)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = new URL(`${baseUrl()}/einfo.fcgi`)
    url.searchParams.set('db', 'pubmed')
    url.searchParams.set('retmode', 'json')
    apiKeyParam(url)
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'einfo reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ncbiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
