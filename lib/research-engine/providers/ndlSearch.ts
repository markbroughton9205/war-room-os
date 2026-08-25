import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ndl_search' as const
const BASE_URL = 'https://ndlsearch.ndl.go.jp/api/opensearch'
const MAX_RESULTS = 25

function extractTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!match) return null
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()
}

function stripHtml(text: string | null): string | null {
  if (!text) return null
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped || null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ndl_search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('any', text)
  url.searchParams.set('cnt', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  if (!result.text.includes('<item>')) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const items = result.text.match(/<item>[\s\S]*?<\/item>/g) ?? []
  const documents = items.slice(0, limit).map((item, index) => {
    const link = extractTag(item, 'link') ?? extractTag(item, 'guid')
    const id = link ?? `${text}:${index}`
    const title = extractTag(item, 'dc:title') ?? extractTag(item, 'title') ?? id
    const creator = extractTag(item, 'dc:creator')
    const description = stripHtml(extractTag(item, 'dc:description') ?? extractTag(item, 'description'))
    const pubDate = extractTag(item, 'pubDate')
    const canonicalUrl = link ?? `https://ndlsearch.ndl.go.jp/`
    return makeDocument({
      id: `ndl_search:${id}`,
      provider: PROVIDER,
      providerRecordId: id,
      title,
      summary: description,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'National Diet Library Search (Japan)',
      contentType: 'library_record',
      authors: creator ? [creator] : [],
      organization: 'National Diet Library, Japan',
      publishedAt: pubDate,
      updatedAt: null,
      geography: 'JP',
      language: 'ja',
      identifiers: {},
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
      throw new Error(`NDL Search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?any=test&cnt=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'opensearch endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ndlSearchAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
