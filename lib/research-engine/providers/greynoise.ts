import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'greynoise' as const
const BASE_URL = 'https://api.greynoise.io/v3/community'
const IP_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

type CommunityResult = { ip?: string; noise?: boolean; riot?: boolean; classification?: string; name?: string; message?: string }

/** GreyNoise's Community API is genuinely zero-auth, no key required
 * (confirmed live). Gotcha confirmed live: it returns HTTP 404 for a
 * legitimate "not noise" clean-IP result — a real API quirk, not an error;
 * the JSON body must be checked instead of trusting HTTP status alone. */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const ip = query.text.trim()
  if (!IP_PATTERN.test(ip)) {
    throw new Error('Query must be an IPv4 address (e.g. "8.8.8.8").')
  }
  const cacheKey = `greynoise:${ip}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${ip}`, { timeoutMs: 12_000 })
  // 404 is an expected, honest "not classified as noise" result here, not a failure.
  if (!result.ok && result.status !== 404) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CommunityResult>(result.text)
  if (!data?.ip) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://viz.greynoise.io/ip/${ip}`
  const documents = [makeDocument({
    id: `greynoise:${ip}`,
    provider: PROVIDER,
    providerRecordId: ip,
    title: `${ip} — ${data.classification ?? (data.noise ? 'noise' : 'unclassified')}`,
    summary: data.message ?? null,
    contentSnippet: data.name ? `Name: ${data.name}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'GreyNoise',
    contentType: 'ip_reputation',
    authors: [],
    organization: 'GreyNoise Intelligence',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { ip },
    subjects: [data.classification, data.noise ? 'noise' : null, data.riot ? 'riot' : null].filter((v): v is string => !!v),
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`GreyNoise lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/8.8.8.8`, { timeoutMs: 10_000 })
    const ok = result.ok || result.status === 404
    return { provider: PROVIDER, state: ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: ok ? 'community endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const greynoiseAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
