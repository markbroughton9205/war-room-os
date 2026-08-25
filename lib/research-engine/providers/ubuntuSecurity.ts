import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ubuntu_security' as const
const BASE_URL = 'https://ubuntu.com/security'
const MAX_RESULTS = 25

type Notice = { id?: string; title?: string; summary?: string; published?: string }
type NoticesResponse = { notices?: Notice[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ubuntu_security:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // "details=" is confirmed live to be the working keyword-search param —
  // "cve"/"cves" params either 422 or are silently ignored (real quirk, not
  // a docs assumption).
  const url = new URL(`${BASE_URL}/notices.json`)
  url.searchParams.set('details', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<NoticesResponse>(result.text)
  if (!data || !Array.isArray(data.notices)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Ubuntu Security response "notices" field was missing or not an array.' }
  }

  const documents = data.notices
    .filter(n => typeof n.id === 'string')
    .map(n => {
      const id = n.id as string
      const canonicalUrl = `https://ubuntu.com/security/notices/${id}`
      return makeDocument({
        id: `ubuntu_security:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: n.title ?? id,
        summary: n.summary ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Ubuntu Security Notices',
        contentType: 'security_advisory',
        authors: [],
        organization: 'Canonical',
        publishedAt: n.published ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { usn_id: id },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Ubuntu Security search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/notices.json?details=kernel&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'notices endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ubuntuSecurityAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
