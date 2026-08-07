import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { validateBoundedTargetUrl } from '@/lib/research-engine/security/targetUrlValidator'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'wayback' as const

const MAX_RESULTS = 20
// Documented default CDX field order for output=json.
const EXPECTED_HEADER = ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length']

class WaybackQueryError extends Error {}

class WaybackProviderError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('WAYBACK_BASE_URL', descriptor)) || 'https://web.archive.org'
}

/** CDX timestamps are `YYYYMMDDhhmmss`; converts to an ISO date string, returning null (never throwing) for anything else. */
function timestampToIso(timestamp: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(timestamp)
  if (!match) return null
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

function sanitizeCdxDate(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null
  const digits = value.replace(/[^0-9]/g, '')
  return /^\d{4,14}$/.test(digits) ? digits.slice(0, 14) : null
}

function normalizeRow(row: string[]) {
  const timestamp = row[1] ?? ''
  const original = row[2] ?? ''
  const mimetype = row[3] || null
  const digest = row[5] || null
  const canonicalUrl = timestamp && original ? `https://web.archive.org/web/${timestamp}/${original}` : null

  return makeDocument({
    id: `wayback:${timestamp}:${original}`,
    provider: PROVIDER,
    providerRecordId: timestamp || null,
    title: original ? `Archived capture of ${original} (${timestamp})` : `Archived capture (${timestamp})`,
    summary: null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Wayback Machine',
    contentType: 'web_archive_capture',
    authors: [],
    organization: 'Internet Archive',
    publishedAt: timestampToIso(timestamp),
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: {
      ...(timestamp ? { wayback_timestamp: timestamp } : {}),
      ...(original ? { wayback_original_url: original } : {}),
      ...(digest ? { wayback_digest: digest } : {}),
      ...(mimetype ? { wayback_mimetype: mimetype } : {}),
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const validated = validateBoundedTargetUrl(query.text)
  if (!validated.ok) throw new WaybackQueryError(validated.reason)

  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const from = sanitizeCdxDate(query.dateFrom)
  const to = sanitizeCdxDate(query.dateTo)
  const cacheKey = `wayback:cdx:${validated.url}:${limit}:${from ?? '-'}:${to ?? '-'}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/cdx/search/cdx`)
  url.searchParams.set('url', validated.url)
  url.searchParams.set('output', 'json')
  url.searchParams.set('limit', String(-limit))
  url.searchParams.set('filter', 'statuscode:200')
  url.searchParams.set('collapse', 'timestamp:8')
  url.searchParams.set('gzip', 'false')
  if (from) url.searchParams.set('from', from)
  if (to) url.searchParams.set('to', to)
  // No `resumeKey`/`showResumeKey` is ever requested or followed.

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<unknown>(result.text)
  if (!Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Wayback CDX response was not a valid JSON array.' }
  }
  if (parsed.length === 0) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }
  const header = parsed[0]
  if (!Array.isArray(header) || header[0] !== EXPECTED_HEADER[0] || header[1] !== EXPECTED_HEADER[1]) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Wayback CDX response did not carry the documented header row shape.' }
  }

  const rows = parsed.slice(1, 1 + MAX_RESULTS).filter((row): row is string[] => Array.isArray(row) && row.every(cell => typeof cell === 'string'))
  const documents = rows.map(normalizeRow)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new WaybackProviderError(`Wayback CDX search failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new WaybackProviderError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof WaybackQueryError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: 'unknown', message: error.message, httpStatus: null }, 0)
    }
    if (error instanceof WaybackProviderError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = `${baseUrl()}/cdx/search/cdx?url=archive.org&output=json&limit=-1&gzip=false`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'cdx search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const waybackAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
