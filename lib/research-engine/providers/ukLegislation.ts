import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { extractXmlBlocks, extractXmlText, extractXmlAttribute } from '@/lib/research-engine/security/xmlLite'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'uk_legislation' as const
const BASE_URL = 'https://www.legislation.gov.uk/search/data.feed'
const MAX_RESULTS = 20

function parseEntry(entryXml: string) {
  return {
    id: extractXmlText(entryXml, 'id'),
    title: extractXmlText(entryXml, 'title'),
    updated: extractXmlText(entryXml, 'updated'),
    published: extractXmlText(entryXml, 'published'),
    summary: extractXmlText(entryXml, 'summary'),
    htmlUrl: extractXmlAttribute(entryXml, 'link', 'href'),
  }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `uk_legislation:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('title', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const entries = extractXmlBlocks(result.text, 'entry').slice(0, limit).map(parseEntry)
  const documents = entries
    .filter(entry => entry.id && entry.title)
    .map(entry => {
      const id = entry.id as string
      const canonicalUrl = entry.htmlUrl ?? id
      return makeDocument({
        id: `uk_legislation:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: entry.title as string,
        summary: entry.summary,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'legislation.gov.uk',
        contentType: 'legislation',
        authors: [],
        organization: 'UK National Archives',
        publishedAt: entry.published,
        updatedAt: entry.updated,
        geography: 'UK',
        language: 'en',
        identifiers: { legislation_gov_uk_id: id },
        subjects: [],
        license: 'Open Government Licence',
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`legislation.gov.uk search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?title=data`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search feed reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ukLegislationAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
