import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'courtlistener' as const
const BASE_URL = 'https://www.courtlistener.com/api/rest/v4'
const TRUSTED_ORIGIN = 'https://www.courtlistener.com'
const TRUSTED_HOSTNAME = 'www.courtlistener.com'

const MAX_QUERY_TEXT_LENGTH = 300
const MAX_RESULTS = 20

type ClResult = {
  cluster_id?: number | string | null
  absolute_url?: string | null
  caseName?: string | null
  dateFiled?: string | null
  court?: string | null
  court_id?: string | null
  status?: string | null
  docketNumber?: string | null
  citation?: string[] | null
}
type ClSearchResponse = { count?: number; results?: ClResult[]; next?: string | null; previous?: string | null }

class CourtListenerError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function authHeaders(): Record<string, string> {
  const token = process.env.COURTLISTENER_API_TOKEN?.trim()
  return token ? { Authorization: `Token ${token}` } : {}
}

/**
 * Resolves upstream `absolute_url` into a canonical URL, accepting only a
 * genuine relative path rooted at `/` on the trusted CourtListener origin.
 * Never string-concatenates the trusted origin with caller-influenced
 * upstream data: `new URL(relativePath, trustedOrigin)` is used instead, and
 * the result is post-validated (https, exact hostname, default port, no
 * embedded credentials) so a crafted `absolute_url` — e.g. a protocol-relative
 * `//evil.example/...`, a full off-host URL, or a value containing `@` or a
 * backslash that some URL parsers would treat as an authority separator —
 * can never surface as an off-host canonicalUrl. Returns null both when
 * `absolute_url` is absent and when it is present but unsafe/unusable; the
 * caller distinguishes the two by checking `result.absolute_url` first.
 */
function resolveCanonicalUrl(absoluteUrl: string): string | null {
  if (!absoluteUrl.startsWith('/') || absoluteUrl.startsWith('//') || absoluteUrl.includes('\\')) return null

  let resolved: URL
  try {
    resolved = new URL(absoluteUrl, TRUSTED_ORIGIN)
  } catch {
    return null
  }

  if (resolved.protocol !== 'https:') return null
  if (resolved.hostname !== TRUSTED_HOSTNAME) return null
  if (resolved.port !== '') return null
  if (resolved.username || resolved.password) return null

  return resolved.toString()
}

/** Returns null to signal the whole record should be skipped when `absolute_url` is present but unsafe/unusable. */
function normalizeResult(result: ClResult): ReturnType<typeof makeDocument> | null {
  let canonicalUrl: string | null = null
  if (result.absolute_url) {
    canonicalUrl = resolveCanonicalUrl(result.absolute_url)
    if (canonicalUrl === null) return null
  }

  const clusterId = result.cluster_id != null ? String(result.cluster_id) : null
  const title = result.caseName?.trim() || 'Untitled opinion'

  return makeDocument({
    id: `courtlistener:${clusterId ?? title}`,
    provider: PROVIDER,
    providerRecordId: clusterId,
    title,
    summary: null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'CourtListener',
    contentType: 'case_law_opinion',
    authors: [],
    // `court` (documented display name) is preserved as the organization only when supplied — never fabricated.
    organization: result.court ?? null,
    publishedAt: result.dateFiled ?? null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: {
      ...(clusterId ? { courtlistener_cluster_id: clusterId } : {}),
      ...(result.court_id ? { courtlistener_court_id: result.court_id } : {}),
      ...(result.docketNumber ? { courtlistener_docket_number: result.docketNumber } : {}),
      // Precedential/status is only recorded when the provider itself supplies it — never inferred or defaulted.
      ...(result.status ? { courtlistener_status: result.status } : {}),
    },
    subjects: Array.isArray(result.citation) ? result.citation.filter((c): c is string => typeof c === 'string').slice(0, 10) : [],
    license: null,
    accessStatus: 'open',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, MAX_QUERY_TEXT_LENGTH)
  const cacheKey = `courtlistener:search:${text}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search/`)
  url.searchParams.set('q', text)
  url.searchParams.set('type', 'o')
  // No `order_by` override, no `page`/cursor param — the documented relevance
  // default is used and the next-page cursor in the response is never followed.

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: authHeaders(), timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<ClSearchResponse>(result.text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CourtListener response was not a valid JSON object.' }
  }
  if (!Array.isArray(parsed.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CourtListener response "results" field was missing or not an array.' }
  }

  const results = parsed.results.slice(0, MAX_RESULTS)
  const documents = results.map(normalizeResult).filter((doc): doc is NonNullable<typeof doc> => doc !== null)
  if (results.length > 0 && documents.length === 0) {
    return { ok: false as const, kind: 'malformed' as const, message: 'CourtListener response contained results but none had a safe, usable canonical URL.' }
  }
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'COURTLISTENER_API_TOKEN is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new CourtListenerError(`CourtListener search failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new CourtListenerError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof CourtListenerError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'COURTLISTENER_API_TOKEN missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search/?q=test&type=o`, { headers: authHeaders(), timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const courtListenerAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
