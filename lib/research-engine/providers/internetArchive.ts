import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'internet_archive' as const

const MAX_QUERY_TEXT_LENGTH = 300
const MAX_RESULTS = 20
// Fixed, allowlisted metadata fields only — no unrestricted advanced-search
// field-query passthrough is ever exposed to the caller.
const FIELDS = ['identifier', 'title', 'description', 'mediatype', 'date', 'creator']

type IaDoc = {
  identifier?: string
  title?: string | string[]
  description?: string | string[]
  mediatype?: string
  date?: string
  creator?: string | string[]
}
type IaResponse = { response?: { numFound?: number; start?: number; docs?: IaDoc[] } }

class InternetArchiveError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('INTERNET_ARCHIVE_BASE_URL', descriptor)) || 'https://archive.org'
}

function userAgent(): string {
  const base = process.env.INTERNET_ARCHIVE_USER_AGENT_BASE?.trim() || 'WarRoomResearchEngine/1.0'
  return `${base} (Research Engine; contact via War Room)`
}

/**
 * Encodes caller-supplied search text as a single literal Solr/Lucene phrase
 * query. Solr treats the contents of a double-quoted phrase as literal terms
 * to match, not as query syntax — so wrapping in quotes is what stops field
 * selectors (`title:`), boolean operators (`AND`/`OR`/`NOT`), grouping
 * parentheses, wildcards (`*`/`?`), range syntax (`[... TO ...]`), proximity
 * modifiers, and other advanced-search syntax from ever being interpreted.
 * Escaping backslash and double-quote is what stops the caller's text from
 * breaking back out of that phrase early.
 */
function toLiteralSolrQuery(text: string): string {
  const withoutControlChars = text.replace(/[\x00-\x1f\x7f]/g, ' ')
  const escaped = withoutControlChars.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

function firstOrJoin(value: string | string[] | undefined | null): string | null {
  if (!value) return null
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' && v.trim()).join('; ') || null
  return value.trim() || null
}

function toList(value: string | string[] | undefined | null): string[] {
  if (!value) return []
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [value]
}

function normalizeDoc(doc: IaDoc) {
  const identifier = doc.identifier ?? null
  const title = firstOrJoin(doc.title) || 'Untitled item'
  const canonicalUrl = identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : null

  return makeDocument({
    id: `internet_archive:${identifier ?? title}`,
    provider: PROVIDER,
    providerRecordId: identifier,
    title,
    summary: firstOrJoin(doc.description),
    contentSnippet: firstOrJoin(doc.description),
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Internet Archive',
    contentType: doc.mediatype ?? 'archive_item',
    authors: toList(doc.creator).slice(0, 10),
    organization: null,
    publishedAt: doc.date ?? null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: identifier ? { internet_archive_identifier: identifier } : {},
    subjects: [],
    license: null,
    accessStatus: 'unknown',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, MAX_QUERY_TEXT_LENGTH)
  const rows = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `internet_archive:search:${text}:${rows}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/advancedsearch.php`)
  url.searchParams.set('q', toLiteralSolrQuery(text))
  for (const field of FIELDS) url.searchParams.append('fl[]', field)
  url.searchParams.set('rows', String(rows))
  url.searchParams.set('page', '1')
  url.searchParams.set('output', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<IaResponse>(result.text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Internet Archive response was not a valid JSON object.' }
  }
  if (!parsed.response || typeof parsed.response !== 'object' || Array.isArray(parsed.response) || !Array.isArray(parsed.response.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Internet Archive response "response.docs" field was missing or not an array.' }
  }

  const docs = parsed.response.docs.slice(0, MAX_RESULTS)
  const documents = docs.map(normalizeDoc)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'INTERNET_ARCHIVE_USER_AGENT_BASE is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new InternetArchiveError(`Internet Archive search failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new InternetArchiveError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof InternetArchiveError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'INTERNET_ARCHIVE_USER_AGENT_BASE missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/advancedsearch.php?q=test&rows=1&output=json`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'advancedsearch endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const internetArchiveAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
