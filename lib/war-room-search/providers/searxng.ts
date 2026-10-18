/**
 * Self-hosted SearXNG federation adapter for War Room Search.
 *
 * Discovery provider only. It finds pages through a Commander-configured
 * SearXNG instance and its upstream engines. It is NOT an evidence author,
 * NOT a crawler/index, and NOT a replacement for Google, Tavily, RSS, or
 * research-engine adapters.
 *
 * Configuration (server-only, never returned to the browser):
 *   SEARXNG_BASE_URL          required to enable the provider
 *   SEARXNG_AUTH_HEADER       optional reverse-proxy header name
 *   SEARXNG_AUTH_VALUE        optional reverse-proxy header value
 *   SEARXNG_TIMEOUT_MS        optional, default 10000
 *
 * SearXNG has no native API-key scheme. Do not invent one. If the deployment
 * is protected, the reverse proxy's header auth is the supported mechanism.
 *
 * Privacy boundary (accurate, not absolute anonymity):
 *   Commander → War Room → SearXNG → upstream engines.
 * Commander search text never changes the configured host. User IP is not forwarded.
 */

import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'

export const SEARXNG_PROVIDER_ID = 'searxng'
export const SEARXNG_DEFAULT_TIMEOUT_MS = 10_000
export const SEARXNG_MIN_TIMEOUT_MS = 2_000
export const SEARXNG_MAX_TIMEOUT_MS = 20_000
export const SEARXNG_MAX_RESULTS = 20

export const SEARXNG_WARNING_CODES = [
  'SEARXNG_NOT_CONFIGURED',
  'SEARXNG_UNREACHABLE',
  'SEARXNG_AUTH_REQUIRED',
  'SEARXNG_TIMEOUT',
  'SEARXNG_INVALID_RESPONSE',
  'SEARXNG_RATE_LIMITED',
  'SEARXNG_UNAVAILABLE',
] as const

export type SearxngWarningCode = (typeof SEARXNG_WARNING_CODES)[number]

export type SearxngHit = {
  title: string
  url: string
  snippet: string
  publishedAt: string | null
  language: string | null
  category: string | null
  providerRank: number | null
  /** SearXNG score when supplied — ranking signal only, never War Room truth. */
  providerScore: number | null
  /** Upstream engines that surfaced this URL through SearXNG. */
  upstreamEngines: string[]
  sourceDomain: string | null
}

export type SearxngLeg = {
  ok: boolean
  configured: boolean
  results: SearxngHit[]
  error?: string
  warningCode?: SearxngWarningCode
  durationMs: number
  statusCode: number | null
  rawCount: number
  dedupedCount: number
  enginesObserved: string[]
}

export type SearxngQueryOptions = {
  pageSize?: number
  safeSearch?: boolean
  language?: string | null
  timeRange?: 'day' | 'week' | 'month' | 'year' | null
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  env?: SearxngEnv
}

export type SearxngEnv = Record<string, string | undefined>

export type SearxngConfig = {
  baseUrl: string
  searchUrl: string
  authHeader: string | null
  authValue: string | null
  timeoutMs: number
}

const SECRET_VALUE = /(?:sk-|AIza|Bearer\s+)[A-Za-z0-9._-]{8,}/g
const PRIVATE_IPV4 = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[0-1])\.)/
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i

export function emptySearxngLeg(error?: string, warningCode?: SearxngWarningCode): SearxngLeg {
  return {
    ok: false,
    configured: false,
    results: [],
    error,
    warningCode,
    durationMs: 0,
    statusCode: null,
    rawCount: 0,
    dedupedCount: 0,
    enginesObserved: [],
  }
}

export function clampSearxngTimeoutMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return SEARXNG_DEFAULT_TIMEOUT_MS
  return Math.max(SEARXNG_MIN_TIMEOUT_MS, Math.min(SEARXNG_MAX_TIMEOUT_MS, Math.floor(n)))
}

export function clampSearxngPageSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 8
  return Math.max(1, Math.min(SEARXNG_MAX_RESULTS, Math.floor(n)))
}

export function searxngTimeRangeFromDate(from?: string | null): 'day' | 'week' | 'month' | 'year' | null {
  if (!from) return null
  const fromMs = Date.parse(from)
  if (!Number.isFinite(fromMs)) return null
  const days = Math.max(1, Math.round((Date.now() - fromMs) / 86_400_000))
  if (days <= 1) return 'day'
  if (days <= 7) return 'week'
  if (days <= 31) return 'month'
  if (days <= 366) return 'year'
  return null
}

function trimEnv(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

/**
 * Operator-configured SearXNG origin only. Commander query text is never used here.
 * Allows HTTP on trusted loopback / RFC1918 / .internal hosts for LAN deployments.
 * Rejects credentials-in-URL, non-http(s) schemes, and cloud-metadata hosts.
 */
export function validateSearxngBaseUrl(raw: string | null | undefined): { ok: true; url: URL } | { ok: false; reason: string } {
  const value = trimEnv(raw ?? undefined)
  if (!value) return { ok: false, reason: 'SEARXNG_NOT_CONFIGURED' }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, reason: 'SEARXNG_UNAVAILABLE' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'SEARXNG_UNAVAILABLE' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'SEARXNG_UNAVAILABLE' }
  }
  const host = parsed.hostname.toLowerCase()
  if (!host || host === 'metadata.google.internal' || host === '169.254.169.254') {
    return { ok: false, reason: 'SEARXNG_UNAVAILABLE' }
  }
  if (parsed.protocol === 'http:' && !isTrustedInternalSearxngHost(host)) {
    return { ok: false, reason: 'SEARXNG_UNAVAILABLE' }
  }
  return { ok: true, url: parsed }
}

export function isTrustedInternalSearxngHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (PRIVATE_HOST.test(host)) return true
  if (PRIVATE_IPV4.test(host)) return true
  if (host === '::1' || host === '[::1]') return true
  return false
}

export function readSearxngConfig(env: SearxngEnv = process.env): SearxngConfig | null {
  const validated = validateSearxngBaseUrl(env.SEARXNG_BASE_URL)
  if (!validated.ok) return null
  const origin = new URL(validated.url.href)
  origin.hash = ''
  origin.search = ''
  const pathname = origin.pathname.replace(/\/+$/, '') || ''
  const searchPath = pathname.endsWith('/search') ? pathname : `${pathname}/search`
  origin.pathname = searchPath
  const searchUrl = origin.href
  const authHeader = trimEnv(env.SEARXNG_AUTH_HEADER)
  const authValue = trimEnv(env.SEARXNG_AUTH_VALUE)
  return {
    baseUrl: `${origin.protocol}//${origin.host}`,
    searchUrl,
    authHeader,
    authValue,
    timeoutMs: clampSearxngTimeoutMs(env.SEARXNG_TIMEOUT_MS),
  }
}

export function searxngConfigured(env: SearxngEnv = process.env): boolean {
  return Boolean(readSearxngConfig(env))
}

export function searxngMissingConfigWarning(env: SearxngEnv = process.env): SearxngWarningCode {
  const raw = trimEnv(env.SEARXNG_BASE_URL)
  if (!raw) return 'SEARXNG_NOT_CONFIGURED'
  const validated = validateSearxngBaseUrl(raw)
  if (!validated.ok) return validated.reason as SearxngWarningCode
  return 'SEARXNG_NOT_CONFIGURED'
}

export function classifySearxngError(input: {
  status?: number | null
  message?: string | null
  timeout?: boolean
  network?: boolean
  invalid?: boolean
}): SearxngWarningCode {
  if (input.timeout) return 'SEARXNG_TIMEOUT'
  if (input.invalid) return 'SEARXNG_INVALID_RESPONSE'
  const status = input.status ?? 0
  const blob = `${input.message ?? ''}`.toLowerCase()
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid.?token|proxy.?auth/i.test(blob)) {
    return 'SEARXNG_AUTH_REQUIRED'
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(blob)) return 'SEARXNG_RATE_LIMITED'
  if (input.network || status >= 500 || status === 0) return 'SEARXNG_UNREACHABLE'
  return 'SEARXNG_UNAVAILABLE'
}

function sanitizeError(message: string): string {
  return message
    .replace(SECRET_VALUE, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/[?&](?:key|token|auth)=[^&\s]+/gi, '[redacted]')
    .slice(0, 180)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function normalizeEngineName(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) return null
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_+\-.]/g, '').slice(0, 48)
  return cleaned || null
}

function enginesFromRow(row: Record<string, unknown>): string[] {
  const collected = new Set<string>()
  const single = normalizeEngineName(row.engine)
  if (single) collected.add(single)
  const list = row.engines
  if (Array.isArray(list)) {
    for (const item of list) {
      const name = normalizeEngineName(item)
      if (name) collected.add(name)
    }
  } else {
    const names = normalizeEngineName(list)
    if (names) collected.add(names)
  }
  return [...collected]
}

function parsePublishedDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  const raw = asString(value)
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function unwrapResultRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const results = root.results
  if (!Array.isArray(results)) return []
  return results.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row))
}

export function mapSearxngResults(payload: unknown): SearxngHit[] {
  const rows = unwrapResultRows(payload)
  const hits: SearxngHit[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const url = asString(row.url ?? row.link ?? row.pretty_url)
    if (!url || !isHttpUrl(url)) continue
    const title = asString(row.title) ?? hostnameFromUrl(url) ?? url
    const snippet = asString(row.content ?? row.snippet ?? row.description) ?? ''
    const positions = row.positions
    const positionFromList = Array.isArray(positions) ? asNumber(positions[0]) : null
    const rank = positionFromList ?? asNumber(row.position ?? row.rank)
    hits.push({
      title,
      url,
      snippet: snippet.slice(0, 900),
      publishedAt: parsePublishedDate(row.publishedDate ?? row.pubdate ?? row.published_at),
      language: asString(row.language)?.slice(0, 16) ?? null,
      category: asString(row.category)?.slice(0, 32) ?? null,
      providerRank: rank && rank >= 1 ? Math.floor(rank) : index + 1,
      providerScore: asNumber(row.score),
      upstreamEngines: enginesFromRow(row),
      sourceDomain: hostnameFromUrl(url),
    })
  }
  return hits
}

export function collapseSearxngHitsByCanonicalUrl(hits: SearxngHit[]): SearxngHit[] {
  const byKey = new Map<string, SearxngHit>()
  for (const hit of hits) {
    const key = canonicalizeUrl(hit.url) ?? hit.url
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...hit, upstreamEngines: [...hit.upstreamEngines] })
      continue
    }
    const engines = [...new Set([...existing.upstreamEngines, ...hit.upstreamEngines])]
    const keepExistingSnippet = existing.snippet.length >= hit.snippet.length
    byKey.set(key, {
      ...existing,
      snippet: keepExistingSnippet ? existing.snippet : hit.snippet,
      publishedAt: existing.publishedAt ?? hit.publishedAt,
      language: existing.language ?? hit.language,
      category: existing.category ?? hit.category,
      providerScore: existing.providerScore ?? hit.providerScore,
      upstreamEngines: engines,
      sourceDomain: existing.sourceDomain ?? hit.sourceDomain,
    })
  }
  return [...byKey.values()]
}

export function usesConfiguredSearxngEndpoint(requestUrl: string, config: SearxngConfig): boolean {
  try {
    const parsed = new URL(requestUrl)
    const expected = new URL(config.searchUrl)
    return parsed.origin === expected.origin
      && parsed.pathname === expected.pathname
      && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
  } catch {
    return false
  }
}

function requestHeaders(config: SearxngConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.authHeader && config.authValue) {
    const name = config.authHeader.slice(0, 64)
    if (/^[A-Za-z0-9-]+$/.test(name) && !/^host$/i.test(name)) {
      headers[name] = config.authValue
    }
  }
  return headers
}

function buildSearchUrl(query: string, config: SearxngConfig, options: SearxngQueryOptions): URL {
  const url = new URL(config.searchUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('pageno', '1')
  url.searchParams.set('safesearch', options.safeSearch === false ? '0' : '1')
  const language = options.language?.trim()
  if (language) url.searchParams.set('language', language.slice(0, 16))
  if (options.timeRange) url.searchParams.set('time_range', options.timeRange)
  return url
}

export async function runSearxngSearch(
  query: string,
  options: SearxngQueryOptions = {},
): Promise<SearxngLeg> {
  const env = options.env ?? process.env
  const config = readSearxngConfig(env)
  if (!config) {
    const warning = searxngMissingConfigWarning(env)
    return emptySearxngLeg(warning, warning)
  }
  const q = query.trim()
  if (!q) {
    return { ...emptySearxngLeg('SEARXNG_UNAVAILABLE', 'SEARXNG_UNAVAILABLE'), configured: true }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const started = Date.now()
  const requestUrl = buildSearchUrl(q, config, options)
  if (!usesConfiguredSearxngEndpoint(requestUrl.toString(), config)) {
    return {
      ...emptySearxngLeg('SEARXNG_UNAVAILABLE', 'SEARXNG_UNAVAILABLE'),
      configured: true,
      durationMs: Date.now() - started,
    }
  }

  const timeout = AbortSignal.timeout(config.timeoutMs)
  const signal = options.signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([timeout, options.signal])
    : timeout

  try {
    const response = await fetchImpl(requestUrl.toString(), {
      method: 'GET',
      headers: requestHeaders(config),
      signal,
      redirect: 'error',
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
      const warningCode = classifySearxngError({
        status: response.status,
        message: sanitizeError(text.slice(0, 200)),
      })
      return {
        ok: false,
        configured: true,
        results: [],
        error: warningCode,
        warningCode,
        durationMs,
        statusCode: response.status,
        rawCount: 0,
        dedupedCount: 0,
        enginesObserved: [],
      }
    }
    if (payload == null || Array.isArray(payload) || typeof payload !== 'object') {
      return {
        ok: false,
        configured: true,
        results: [],
        error: 'SEARXNG_INVALID_RESPONSE',
        warningCode: 'SEARXNG_INVALID_RESPONSE',
        durationMs,
        statusCode: response.status,
        rawCount: 0,
        dedupedCount: 0,
        enginesObserved: [],
      }
    }
    const mapped = mapSearxngResults(payload)
    const collapsed = collapseSearxngHitsByCanonicalUrl(mapped)
    const limited = collapsed.slice(0, clampSearxngPageSize(options.pageSize))
    const enginesObserved = [...new Set(limited.flatMap(item => item.upstreamEngines))]
    return {
      ok: true,
      configured: true,
      results: limited,
      durationMs,
      statusCode: response.status,
      rawCount: mapped.length,
      dedupedCount: collapsed.length,
      enginesObserved,
    }
  } catch (error) {
    const durationMs = Date.now() - started
    const message = error instanceof Error ? error.message : String(error)
    const timeoutHit = options.signal?.aborted
      ? false
      : /timeout|aborted|abort/i.test(message) || (error instanceof Error && error.name === 'TimeoutError')
    const warningCode = classifySearxngError({
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
      rawCount: 0,
      dedupedCount: 0,
      enginesObserved: [],
    }
  }
}
