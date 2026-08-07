import 'server-only'

import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import { assertAllowedProviderUrl, isAllowedHost } from '@/lib/research-engine/security/hostAllowlist'
import { redactSecretsFromText, redactUrlForLogging } from '@/lib/research-engine/security/redact'

export type SafeFetchOptions = {
  timeoutMs?: number
  maxRetries?: number
  maxResponseBytes?: number
  maxRedirects?: number
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  body?: string
}

export type SafeFetchResult = {
  ok: boolean
  status: number
  text: string
  truncated: boolean
  contentType: string | null
  durationMs: number
  attempts: number
  finalUrl: string
}

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024 // 8 MB decompressed cap
const DEFAULT_MAX_REDIRECTS = 3

let providerFetch: typeof fetch = fetch

/** Test-only hook: replaces the underlying fetch implementation so validation tests never touch the network. */
export function __setResearchFetchForTests(fetchImpl: typeof fetch | null): void {
  providerFetch = fetchImpl ?? fetch
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function backoffWithJitter(attempt: number): number {
  const base = 400 * 2 ** attempt
  const jitter = Math.random() * 250
  return Math.min(base + jitter, 8_000)
}

function retryDelayFromRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 15_000)
  const asDate = Date.parse(header)
  if (Number.isFinite(asDate)) return Math.max(0, Math.min(asDate - Date.now(), 15_000))
  return null
}

async function readBodyWithCap(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes }
  }
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > maxBytes) {
      truncated = true
      const allowed = maxBytes - (received - value.byteLength)
      if (allowed > 0) chunks.push(value.slice(0, allowed))
      await reader.cancel().catch(() => undefined)
      break
    }
    chunks.push(value)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), truncated }
}

/**
 * The single reusable server-side HTTP client for every Research Engine
 * provider adapter. Enforces HTTPS + host allowlisting, timeouts, capped
 * retries with backoff+jitter honoring Retry-After, a decompressed
 * response-size cap, and manual redirect handling that never forwards
 * caller-supplied auth headers across a hostname change.
 */
export async function safeProviderFetch(provider: ResearchProviderId, url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const startedAt = Date.now()

  let currentUrl = assertAllowedProviderUrl(provider, url).toString()
  let attempts = 0

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    attempts += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let response: Response
      let redirects = 0
      let hopUrl = currentUrl
      const originalHost = new URL(currentUrl).hostname
      for (;;) {
        response = await providerFetch(hopUrl, {
          method: options.method ?? 'GET',
          headers: options.headers,
          body: options.body,
          redirect: 'manual',
          signal: controller.signal,
          credentials: 'omit',
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) break
          redirects += 1
          if (redirects > maxRedirects) {
            throw new Error(`Too many redirects for provider ${provider}`)
          }
          const nextUrl = new URL(location, hopUrl)
          if (nextUrl.protocol !== 'https:' || !isAllowedHost(provider, nextUrl.hostname)) {
            throw new Error(`Blocked redirect to disallowed host for provider ${provider}`)
          }
          if (nextUrl.hostname !== originalHost) {
            // Cross-host redirect: never forward the original Authorization header onward.
            const strippedHeaders = { ...(options.headers ?? {}) }
            delete strippedHeaders.Authorization
            delete strippedHeaders.authorization
            options = { ...options, headers: strippedHeaders }
          }
          hopUrl = nextUrl.toString()
          continue
        }
        break
      }
      currentUrl = hopUrl

      if ((response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) && attempt < maxRetries) {
        const retryAfter = retryDelayFromRetryAfter(response.headers.get('retry-after'))
        clearTimeout(timer)
        await sleep(retryAfter ?? backoffWithJitter(attempt))
        continue
      }

      const { text, truncated } = await readBodyWithCap(response, maxResponseBytes)
      clearTimeout(timer)
      return {
        ok: response.ok,
        status: response.status,
        text,
        truncated,
        contentType: response.headers.get('content-type'),
        durationMs: Date.now() - startedAt,
        attempts,
        finalUrl: redactUrlForLogging(currentUrl),
      }
    } catch (error) {
      clearTimeout(timer)
      if (attempt >= maxRetries) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(redactSecretsFromText(`Research provider ${provider} request failed: ${message}`))
      }
      await sleep(backoffWithJitter(attempt))
    }
  }

  throw new Error(`Research provider ${provider} exhausted retries`)
}

export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** Parses newline-delimited JSON with a hard line cap, skipping malformed lines rather than throwing. */
export function safeNdjsonParse<T = unknown>(text: string, maxLines = 5_000): T[] {
  const lines = text.split('\n').slice(0, maxLines)
  const results: T[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      results.push(JSON.parse(trimmed) as T)
    } catch {
      continue
    }
  }
  return results
}
