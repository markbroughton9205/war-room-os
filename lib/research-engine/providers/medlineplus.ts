import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { decodeXmlEntities } from '@/lib/research-engine/security/xmlLite'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'medlineplus' as const
const BASE_URL = 'https://wsearch.nlm.nih.gov/ws/query'
const MAX_RESULTS = 15

/** Strips both the MedlinePlus highlight-wrapper spans (class="qt0"/"qt1") and any other tags, then decodes entities. */
function cleanText(raw: string): string {
  return decodeXmlEntities(raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
}

type ParsedDocument = { url: string | null; title: string | null; snippet: string | null; organizationName: string | null }

/** MedlinePlus's XML uses attribute-addressed `<content name="FIELD">` elements inside `<document url="...">` — not a shape any existing xmlLite helper covers, so parsed locally with a small dedicated regex pass. */
function parseDocuments(xml: string): ParsedDocument[] {
  const docs: ParsedDocument[] = []
  const docRe = /<document\b([^>]*)>([\s\S]*?)<\/document>/g
  let docMatch: RegExpExecArray | null
  while ((docMatch = docRe.exec(xml)) !== null) {
    const [, attrs, inner] = docMatch
    const urlMatch = /\burl="([^"]*)"/.exec(attrs)
    const contentRe = /<content\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/content>/g
    const fields: Record<string, string> = {}
    let contentMatch: RegExpExecArray | null
    while ((contentMatch = contentRe.exec(inner)) !== null) {
      const [, name, value] = contentMatch
      if (!(name in fields)) fields[name] = value // first occurrence only (e.g. repeated altTitle/mesh tags are not needed for this bounded adapter)
    }
    docs.push({
      url: urlMatch ? decodeXmlEntities(urlMatch[1]) : null,
      title: fields.title ? cleanText(fields.title) : null,
      snippet: fields.snippet ? cleanText(fields.snippet) : null,
      organizationName: fields.organizationName ? cleanText(fields.organizationName) : null,
    })
  }
  return docs
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `medlineplus:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('db', 'healthTopics')
  url.searchParams.set('term', text)
  url.searchParams.set('rettype', 'brief')
  url.searchParams.set('retmax', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = parseDocuments(result.text)
  const documents = parsed
    .filter(doc => doc.url && doc.title)
    .slice(0, limit)
    .map(doc => makeDocument({
      id: `medlineplus:${doc.url}`,
      provider: PROVIDER,
      providerRecordId: doc.url,
      title: doc.title as string,
      summary: doc.snippet,
      contentSnippet: doc.snippet,
      canonicalUrl: doc.url,
      sourceUrl: doc.url,
      sourceName: 'MedlinePlus',
      contentType: 'health_topic',
      authors: [],
      organization: doc.organizationName,
      publishedAt: null,
      updatedAt: null,
      geography: null,
      language: 'en',
      identifiers: {},
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
      if (outcome.ok) return outcome.response
      throw new Error(`MedlinePlus search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?db=healthTopics&term=health&rettype=brief&retmax=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'query endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const medlineplusAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
