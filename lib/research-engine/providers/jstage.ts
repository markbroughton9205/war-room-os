import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { extractXmlBlocks, extractXmlText } from '@/lib/research-engine/security/xmlLite'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'jstage' as const
const BASE_URL = 'https://api.jstage.jst.go.jp/searchapi/do'
const MAX_RESULTS = 25

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `jstage:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('service', '3')
  url.searchParams.set('text', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const entries = extractXmlBlocks(result.text, 'entry').slice(0, limit)
  const documents = entries.map((entry, index) => {
    const titleBlock = extractXmlBlocks(entry, 'article_title')[0] ?? ''
    const title = extractXmlText(titleBlock, 'en') || extractXmlText(titleBlock, 'ja') || `Article ${index}`
    const journal = extractXmlText(entry, 'cdjournal')
    const materialBlock = extractXmlBlocks(entry, 'material_title')[0] ?? ''
    const materialTitle = extractXmlText(materialBlock, 'en') || extractXmlText(materialBlock, 'ja')
    const linkBlock = extractXmlBlocks(entry, 'article_link')[0] ?? ''
    const link = (extractXmlText(linkBlock, 'en') || extractXmlText(linkBlock, 'ja')) ?? null
    const idBase = link ?? `jstage:${text}:${index}`
    return makeDocument({
      id: `jstage:${idBase}`,
      provider: PROVIDER,
      providerRecordId: idBase,
      title,
      summary: materialTitle ?? null,
      contentSnippet: journal ? `Journal: ${journal}` : null,
      canonicalUrl: link ?? 'https://www.jstage.jst.go.jp/browse/-char/en',
      sourceUrl: link ?? 'https://www.jstage.jst.go.jp/browse/-char/en',
      sourceName: 'J-STAGE',
      contentType: 'journal_article',
      authors: [],
      organization: 'Japan Science and Technology Agency',
      publishedAt: null,
      updatedAt: null,
      geography: 'Japan',
      language: 'en',
      identifiers: {},
      subjects: journal ? [journal] : [],
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
      throw new Error(`J-STAGE search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?service=3&text=science`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'searchapi endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const jstageAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
