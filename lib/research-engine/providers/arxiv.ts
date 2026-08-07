import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { extractAllXmlAttributes, extractXmlBlocks, extractXmlText } from '@/lib/research-engine/security/xmlLite'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'arxiv' as const

// arXiv's usage policy asks for no more than one request every ~3 seconds.
const MIN_INTERVAL_MS = 3_100
let lastRequestAt = 0

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt)
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('ARXIV_API_BASE_URL', descriptor)) || 'https://export.arxiv.org/api/query'
}

function parseEntry(entryXml: string) {
  const id = extractXmlText(entryXml, 'id')
  const arxivIdMatch = id ? /abs\/([^v]+)(v\d+)?$/.exec(id) : null
  const arxivId = arxivIdMatch ? arxivIdMatch[1] : null
  const authorBlocks = extractXmlBlocks(entryXml, 'author')
  const authors = authorBlocks.map(block => extractXmlText(block, 'name')).filter((name): name is string => Boolean(name))
  const pdfLinks = extractAllXmlAttributes(entryXml, 'link', 'href').filter(href => href.includes('/pdf/'))
  return {
    id,
    arxivId,
    title: extractXmlText(entryXml, 'title'),
    summary: extractXmlText(entryXml, 'summary'),
    published: extractXmlText(entryXml, 'published'),
    updated: extractXmlText(entryXml, 'updated'),
    authors,
    pdfUrl: pdfLinks[0] ?? null,
    doi: extractXmlText(entryXml, 'arxiv:doi'),
  }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const cacheKey = `arxiv:search:${query.text}:${query.maxResults ?? 10}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const maxResults = Math.max(1, Math.min(query.maxResults ?? 10, 20))
  const url = new URL(baseUrl())
  url.searchParams.set('search_query', `all:${query.text}`)
  url.searchParams.set('start', '0')
  url.searchParams.set('max_results', String(maxResults))

  await throttle()
  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, status: result.status }

  const entries = extractXmlBlocks(result.text, 'entry').map(parseEntry)
  const documents = entries
    .filter(entry => entry.title)
    .map(entry => makeDocument({
      id: `arxiv:${entry.arxivId ?? entry.id ?? entry.title}`,
      provider: PROVIDER,
      providerRecordId: entry.arxivId,
      title: entry.title as string,
      summary: entry.summary,
      contentSnippet: entry.summary,
      canonicalUrl: entry.id,
      sourceUrl: entry.id,
      sourceName: 'arXiv',
      contentType: 'preprint',
      authors: entry.authors,
      organization: null,
      publishedAt: entry.published,
      updatedAt: entry.updated,
      geography: null,
      language: 'en',
      identifiers: { ...(entry.arxivId ? { arxiv_id: entry.arxivId } : {}), ...(entry.doi ? { doi: entry.doi } : {}) },
      subjects: [],
      license: null,
      accessStatus: 'open',
    }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (!outcome.ok) throw new Error(`arXiv search failed with HTTP ${outcome.status}`)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    await throttle()
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}?search_query=all:test&max_results=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'Atom feed reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const arxivAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
