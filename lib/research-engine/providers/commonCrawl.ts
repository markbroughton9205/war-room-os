import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeNdjsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { validateBoundedTargetUrl } from '@/lib/research-engine/security/targetUrlValidator'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'common_crawl' as const

const MAX_RESULTS = 20
const MAX_NDJSON_LINES = 200
// Bounds the collection id charset — this is a Commander-configured value
// (there is no live discovery of "the current collection"), but it is still
// validated before being interpolated into the request path.
const COLLECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

class CommonCrawlQueryError extends Error {}

class CommonCrawlProviderError extends Error {
  category: 'upstream_error' | 'parse_error' | 'not_configured'
  constructor(message: string, category: 'upstream_error' | 'parse_error' | 'not_configured') {
    super(message)
    this.category = category
  }
}

type CcRecord = {
  urlkey?: string
  timestamp?: string
  url?: string
  mime?: string
  status?: string
  digest?: string
  // `filename`/`offset`/`length` (WARC pointers) are intentionally never
  // read into the normalized output — no WARC retrieval, ever.
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('COMMON_CRAWL_INDEX_BASE_URL', descriptor)) || 'https://index.commoncrawl.org'
}

function collectionId(): string | null {
  const raw = process.env.COMMON_CRAWL_COLLECTION_ID?.trim()
  return raw && COLLECTION_ID_PATTERN.test(raw) ? raw : null
}

function userAgent(): string {
  const base = process.env.COMMON_CRAWL_USER_AGENT_BASE?.trim() || 'WarRoomResearchEngine/1.0'
  return `${base} (Research Engine; contact via War Room)`
}

/** Common Crawl index timestamps use the same `YYYYMMDDhhmmss` format as Wayback CDX. */
function timestampToIso(timestamp: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(timestamp)
  if (!match) return null
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

function normalizeRecord(record: CcRecord) {
  const urlkey = record.urlkey ?? null
  const timestamp = record.timestamp ?? null
  const originalUrl = record.url ?? null

  return makeDocument({
    id: `common_crawl:${urlkey ?? 'unknown'}:${timestamp ?? 'unknown'}`,
    provider: PROVIDER,
    providerRecordId: urlkey && timestamp ? `${urlkey}:${timestamp}` : null,
    title: originalUrl ? `Common Crawl capture of ${originalUrl} (${timestamp ?? 'unknown date'})` : `Common Crawl capture (${timestamp ?? 'unknown date'})`,
    summary: null,
    contentSnippet: null,
    canonicalUrl: originalUrl,
    sourceUrl: originalUrl,
    sourceName: 'Common Crawl',
    contentType: 'web_crawl_capture',
    authors: [],
    organization: 'Common Crawl Foundation',
    publishedAt: timestamp ? timestampToIso(timestamp) : null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: {
      ...(urlkey ? { common_crawl_urlkey: urlkey } : {}),
      ...(timestamp ? { common_crawl_timestamp: timestamp } : {}),
      ...(record.digest ? { common_crawl_digest: record.digest } : {}),
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const validated = validateBoundedTargetUrl(query.text)
  if (!validated.ok) throw new CommonCrawlQueryError(validated.reason)

  const collection = collectionId()
  if (!collection) {
    throw new CommonCrawlProviderError('COMMON_CRAWL_COLLECTION_ID is not configured or is not a valid collection id.', 'not_configured')
  }

  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `common_crawl:${collection}:${validated.url}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/${collection}-index`)
  url.searchParams.set('url', validated.url)
  url.searchParams.set('output', 'json')
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const trimmed = result.text.trim()
  if (trimmed === '') {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const records = safeNdjsonParse<CcRecord>(result.text, MAX_NDJSON_LINES)
  // A non-empty body that yields zero parseable NDJSON lines is a malformed
  // upstream response, never a fabricated empty success. Individual
  // malformed lines within an otherwise-parseable body are silently
  // skipped by safeNdjsonParse (documented, tested policy).
  if (records.length === 0) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Common Crawl index response was non-empty but no line could be parsed as JSON.' }
  }

  const documents = records.slice(0, MAX_RESULTS).map(normalizeRecord)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'COMMON_CRAWL_USER_AGENT_BASE is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new CommonCrawlProviderError(`Common Crawl index search failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new CommonCrawlProviderError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof CommonCrawlQueryError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: 'unknown', message: error.message, httpStatus: null }, 0)
    }
    if (error instanceof CommonCrawlProviderError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'COMMON_CRAWL_USER_AGENT_BASE missing', durationMs: null }
  }
  const collection = collectionId()
  if (!collection) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'COMMON_CRAWL_COLLECTION_ID missing or invalid', durationMs: null }
  }
  try {
    const url = `${baseUrl()}/${collection}-index?url=commoncrawl.org&output=json&limit=1`
    const result = await safeProviderFetch(PROVIDER, url, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'index endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const commonCrawlAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
