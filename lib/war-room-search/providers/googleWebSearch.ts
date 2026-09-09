/**
 * Official Google Web Search Service adapter for War Room Search.
 *
 * Endpoint: GET https://websearchservice.googleapis.com/v1:search
 * This is a discovery provider — it finds pages. It is NOT an evidence author,
 * and it is NOT the retired Site Restricted Custom Search API
 * (`/customsearch/v1/siterestrict`).
 *
 * Credentials (server-only, never returned to the browser, never persisted):
 *   GOOGLE_WEB_SEARCH_API_KEY
 *   GOOGLE_WEB_SEARCH_CLIENT_ID
 *
 * End-user IP: sent only when the incoming server request actually supplied one
 * (X-Forwarded-For / X-Real-IP / CF-Connecting-IP). Never fabricated, never
 * written to search history, never included in API/UI output.
 *
 * Missing credentials → honest GOOGLE_UNAVAILABLE; other federated legs continue.
 */

import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'

export const GOOGLE_WEB_SEARCH_SERVICE = 'websearchservice.googleapis.com'
export const GOOGLE_WEB_SEARCH_ENDPOINT = 'https://websearchservice.googleapis.com/v1:search'
export const RETIRED_SITE_RESTRICTED_CUSTOM_SEARCH_PATH = '/customsearch/v1/siterestrict'
export const GOOGLE_WEB_SEARCH_TIMEOUT_MS = 12_000
export const GOOGLE_WEB_SEARCH_MAX_PAGE_SIZE = 10

export const GOOGLE_WEB_SEARCH_WARNING_CODES = [
  'GOOGLE_UNAVAILABLE',
  'GOOGLE_AUTH_REQUIRED',
  'GOOGLE_TIMEOUT',
  'GOOGLE_QUOTA',
] as const

export type GoogleWebSearchWarningCode = (typeof GOOGLE_WEB_SEARCH_WARNING_CODES)[number]

export type GoogleWebSearchHit = {
  title: string
  url: string
  snippet: string
  displayUrl: string | null
  publishedAt: string | null
  language: string | null
  region: string | null
  providerRank: number | null
}

export type GoogleWebSearchLeg = {
  ok: boolean
  configured: boolean
  results: GoogleWebSearchHit[]
  error?: string
  warningCode?: GoogleWebSearchWarningCode
  durationMs: number
  statusCode: number | null
}

export type GoogleWebSearchQueryOptions = {
  pageSize?: number
  safeSearch?: boolean
  languageCode?: string | null
  regionCode?: string | null
  dateRestrict?: string | null
  /** End-user IP from the incoming request only. Never fabricated. */
  userIp?: string | null
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  env?: GoogleWebSearchEnv
}

export type GoogleWebSearchCredentials = {
  apiKey: string
  clientId: string
}

const SECRET_VALUE = /(?:sk-|AIza|Bearer\s+)[A-Za-z0-9._-]{8,}/g

export type GoogleWebSearchEnv = Record<string, string | undefined>

export function readGoogleWebSearchCredentials(env: GoogleWebSearchEnv = process.env): GoogleWebSearchCredentials | null {
  const apiKey = env.GOOGLE_WEB_SEARCH_API_KEY?.trim() ?? ''
  const clientId = env.GOOGLE_WEB_SEARCH_CLIENT_ID?.trim() ?? ''
  if (!apiKey || !clientId) return null
  return { apiKey, clientId }
}

export function googleWebSearchConfigured(env: GoogleWebSearchEnv = process.env): boolean {
  return Boolean(readGoogleWebSearchCredentials(env))
}

export function googleWebSearchMissingCredentialWarning(env: GoogleWebSearchEnv = process.env): GoogleWebSearchWarningCode {
  const apiKey = env.GOOGLE_WEB_SEARCH_API_KEY?.trim()
  const clientId = env.GOOGLE_WEB_SEARCH_CLIENT_ID?.trim()
  if (apiKey && !clientId) return 'GOOGLE_AUTH_REQUIRED'
  if (!apiKey && clientId) return 'GOOGLE_AUTH_REQUIRED'
  return 'GOOGLE_UNAVAILABLE'
}

export function emptyGoogleWebSearchLeg(error?: string, warningCode?: GoogleWebSearchWarningCode): GoogleWebSearchLeg {
  return {
    ok: false,
    configured: false,
    results: [],
    error,
    warningCode,
    durationMs: 0,
    statusCode: null,
  }
}

export function isLikelyClientIp(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 45) return false
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    return trimmed.split('.').every(octet => {
      const n = Number(octet)
      return Number.isInteger(n) && n >= 0 && n <= 255
    })
  }
  return trimmed.includes(':') && /^[0-9a-f:%.]+$/i.test(trimmed)
}

export function clientIpFromRequestHeaders(headers: Headers | Record<string, string | null | undefined>): string | null {
  const read = (name: string): string | null => {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name)
    const rec = headers as Record<string, string | null | undefined>
    return rec[name] ?? rec[name.toLowerCase()] ?? rec[name.toUpperCase()] ?? null
  }
  const forwarded = read('x-forwarded-for')
  const firstForwarded = forwarded?.split(',')[0]?.trim() ?? null
  const candidates = [firstForwarded, read('x-real-ip')?.trim() ?? null, read('cf-connecting-ip')?.trim() ?? null]
  for (const candidate of candidates) {
    if (candidate && isLikelyClientIp(candidate)) return candidate
  }
  return null
}

export function clampGooglePageSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 8
  return Math.max(1, Math.min(GOOGLE_WEB_SEARCH_MAX_PAGE_SIZE, Math.floor(n)))
}

export function dateRestrictFromSearchRange(from?: string | null, to?: string | null): string | null {
  if (!from && !to) return null
  if (!from) return null
  const fromMs = Date.parse(from)
  if (!Number.isFinite(fromMs)) return null
  const days = Math.max(1, Math.round((Date.now() - fromMs) / 86_400_000))
  if (days <= 1) return 'd1'
  if (days <= 7) return 'd7'
  if (days <= 31) return 'm1'
  if (days <= 366) return 'y1'
  return null
}

export function classifyGoogleWebSearchError(input: {
  status?: number | null
  message?: string | null
  timeout?: boolean
  network?: boolean
}): GoogleWebSearchWarningCode {
  if (input.timeout) return 'GOOGLE_TIMEOUT'
  const status = input.status ?? 0
  const blob = `${input.message ?? ''}`.toLowerCase()
  if (status === 401 || status === 403 || /permission_denied|unauthenticated|invalid.?api.?key|invalid.?client|client.?id/i.test(blob)) {
    return 'GOOGLE_AUTH_REQUIRED'
  }
  if (status === 429 || /resource_exhausted|quota|rate.?limit/i.test(blob)) return 'GOOGLE_QUOTA'
  if (input.network || status >= 500) return 'GOOGLE_UNAVAILABLE'
  if (status === 400 && /client.?id|api.?key|permission/i.test(blob)) return 'GOOGLE_AUTH_REQUIRED'
  return 'GOOGLE_UNAVAILABLE'
}

function sanitizeError(message: string): string {
  return message.replace(SECRET_VALUE, '[redacted]').replace(/[?&](?:key|clientId|client_id)=[^&\s]+/gi, '[redacted]').slice(0, 180)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isGoogleSerpOrCacheUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'google.com' || host.endsWith('.google.com') || host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com')) {
      const path = new URL(url).pathname.toLowerCase()
      if (path.startsWith('/search') || path.startsWith('/url') || path.includes('webcache')) return true
    }
    return false
  } catch {
    return true
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function parseSuppliedDate(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function publishedDateFromItem(item: Record<string, unknown>): string | null {
  const direct = parseSuppliedDate(item.publishedTime ?? item.publishedAt ?? item.datePublished ?? item.published_at)
  if (direct) return direct
  const pagemap = asRecord(item.pagemap)
  const metatags = Array.isArray(pagemap?.metatags) ? pagemap.metatags : []
  const meta = asRecord(metatags[0])
  if (!meta) return null
  return parseSuppliedDate(meta['article:published_time'] ?? meta.pubdate ?? meta['article:published'])
}

function languageFromItem(item: Record<string, unknown>): string | null {
  return asString(item.languageCode ?? item.language ?? item.hl)?.slice(0, 16) ?? null
}

function regionFromItem(item: Record<string, unknown>): string | null {
  return asString(item.regionCode ?? item.region ?? item.gl)?.slice(0, 8) ?? null
}

function rankFromItem(item: Record<string, unknown>, index: number): number {
  const supplied = item.position ?? item.rank ?? item.providerRank
  const n = typeof supplied === 'number' ? supplied : Number(supplied)
  if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  return index + 1
}

function unwrapResultRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const candidates: unknown[] = [
    root.results,
    asRecord(root.web)?.results,
    asRecord(root.searchResults)?.results,
    root.items,
    root.searchResults,
    asRecord(root.response)?.results,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      return candidate.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row))
    }
  }
  if (Array.isArray(root.results)) return []
  return []
}

function documentStruct(item: Record<string, unknown>): Record<string, unknown> {
  const document = asRecord(item.document)
  const derived = asRecord(document?.derivedStructData)
  return derived ?? document ?? item
}

export function mapGoogleWebSearchResults(payload: unknown): GoogleWebSearchHit[] {
  const rows = unwrapResultRows(payload)
  const hits: GoogleWebSearchHit[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const data = documentStruct(row)
    const url = asString(data.link ?? data.url ?? data.canonicalLink ?? row.link ?? row.url)
    if (!url || !isHttpUrl(url) || isGoogleSerpOrCacheUrl(url)) continue
    const title = asString(data.title ?? row.title) ?? hostnameFromUrl(url) ?? url
    const snippet = asString(data.snippet ?? data.htmlSnippet ?? data.summary ?? row.snippet) ?? ''
    const displayUrl = asString(data.displayLink ?? data.displayUrl ?? row.displayLink ?? row.displayUrl)
      ?? hostnameFromUrl(url)
    hits.push({
      title,
      url,
      snippet: snippet.slice(0, 900),
      displayUrl,
      publishedAt: publishedDateFromItem(data) ?? publishedDateFromItem(row),
      language: languageFromItem(data) ?? languageFromItem(row),
      region: regionFromItem(data) ?? regionFromItem(row),
      providerRank: rankFromItem(data, index),
    })
  }
  return hits
}

function buildSearchUrl(query: string, creds: GoogleWebSearchCredentials, options: GoogleWebSearchQueryOptions, minimal: boolean): URL {
  const url = new URL(GOOGLE_WEB_SEARCH_ENDPOINT)
  url.searchParams.set('query', query)
  url.searchParams.set('pageSize', String(clampGooglePageSize(options.pageSize)))
  url.searchParams.set('key', creds.apiKey)
  url.searchParams.set('clientId', creds.clientId)
  if (!minimal) {
    url.searchParams.set('safeSearch', options.safeSearch === false ? 'OFF' : 'ACTIVE')
    const language = options.languageCode?.trim()
    if (language) url.searchParams.set('languageCode', language.slice(0, 16))
    const region = options.regionCode?.trim()
    if (region) url.searchParams.set('regionCode', region.slice(0, 8))
    if (options.dateRestrict) url.searchParams.set('dateRestrict', options.dateRestrict)
    if (options.userIp && isLikelyClientIp(options.userIp)) url.searchParams.set('userIp', options.userIp)
  }
  return url
}

function requestHeaders(creds: GoogleWebSearchCredentials, userIp?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-goog-api-key': creds.apiKey,
  }
  if (userIp && isLikelyClientIp(userIp)) headers['X-Forwarded-For'] = userIp
  return headers
}

function googleErrorMessage(payload: unknown, fallback: string): string {
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  const message = asString(error?.message) ?? asString(root?.message) ?? fallback
  return sanitizeError(message)
}

export function usesOfficialGoogleWebSearchEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.host === GOOGLE_WEB_SEARCH_SERVICE
      && parsed.pathname === '/v1:search'
      && !parsed.pathname.includes(RETIRED_SITE_RESTRICTED_CUSTOM_SEARCH_PATH)
      && !parsed.host.includes('customsearch.googleapis.com')
  } catch {
    return false
  }
}

export async function runGoogleWebSearch(
  query: string,
  options: GoogleWebSearchQueryOptions = {},
): Promise<GoogleWebSearchLeg> {
  const env = options.env ?? process.env
  const creds = readGoogleWebSearchCredentials(env)
  if (!creds) {
    return emptyGoogleWebSearchLeg(
      googleWebSearchMissingCredentialWarning(env),
      googleWebSearchMissingCredentialWarning(env),
    )
  }
  const q = query.trim()
  if (!q) return { ...emptyGoogleWebSearchLeg('GOOGLE_UNAVAILABLE', 'GOOGLE_UNAVAILABLE'), configured: true }

  const fetchImpl = options.fetchImpl ?? fetch
  const started = Date.now()
  const userIp = options.userIp && isLikelyClientIp(options.userIp) ? options.userIp : null

  const attempt = async (minimal: boolean): Promise<GoogleWebSearchLeg> => {
    const requestUrl = buildSearchUrl(q, creds, { ...options, userIp }, minimal)
    if (!usesOfficialGoogleWebSearchEndpoint(requestUrl.toString())) {
      return {
        ok: false,
        configured: true,
        results: [],
        error: 'GOOGLE_UNAVAILABLE',
        warningCode: 'GOOGLE_UNAVAILABLE',
        durationMs: Date.now() - started,
        statusCode: null,
      }
    }
    const timeout = AbortSignal.timeout(GOOGLE_WEB_SEARCH_TIMEOUT_MS)
    const signal = options.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([timeout, options.signal])
      : timeout
    try {
      const response = await fetchImpl(requestUrl.toString(), {
        method: 'GET',
        headers: requestHeaders(creds, userIp),
        signal,
      })
      const durationMs = Date.now() - started
      const text = await response.text()
      let payload: unknown = null
      try {
        payload = text ? JSON.parse(text) as unknown : null
      } catch {
        payload = null
      }
      if (!response.ok) {
        const warningCode = classifyGoogleWebSearchError({
          status: response.status,
          message: googleErrorMessage(payload, `HTTP ${response.status}`),
        })
        return {
          ok: false,
          configured: true,
          results: [],
          error: warningCode,
          warningCode,
          durationMs,
          statusCode: response.status,
        }
      }
      const results = mapGoogleWebSearchResults(payload)
      return {
        ok: true,
        configured: true,
        results,
        durationMs,
        statusCode: response.status,
      }
    } catch (error) {
      const durationMs = Date.now() - started
      const message = error instanceof Error ? error.message : String(error)
      const timeoutHit = options.signal?.aborted
        ? false
        : /timeout|aborted|abort/i.test(message) || (error instanceof Error && error.name === 'TimeoutError')
      const warningCode = classifyGoogleWebSearchError({
        timeout: timeoutHit,
        network: !timeoutHit,
        message: sanitizeError(message),
      })
      return {
        ok: false,
        configured: true,
        results: [],
        error: warningCode,
        warningCode,
        durationMs,
        statusCode: null,
      }
    }
  }

  const first = await attempt(false)
  if (!first.ok && first.statusCode === 400) return attempt(true)
  return first
}
