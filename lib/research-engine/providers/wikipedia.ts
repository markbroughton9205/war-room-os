import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'wikipedia' as const
const BASE_URL = 'https://en.wikipedia.org/api/rest_v1'

type PageSummary = {
  title?: string
  pageid?: number
  extract?: string
  description?: string | null
  timestamp?: string
  content_urls?: { desktop?: { page?: string } }
}

function userAgent(): string {
  const base = process.env.WIKIMEDIA_USER_AGENT_BASE?.trim()
  return base || 'WarRoomResearchEngine/1.0'
}

/**
 * The REST summary endpoint is a page-title lookup, not free-text search
 * (English Wikipedia only — no multi-language host allowlisted this phase).
 * The query's text is treated as a title: spaces become underscores per the
 * documented convention; anything else is passed through and left to the
 * upstream API to 404 on if it isn't a real title.
 */
function titleFromQuery(text: string): string {
  return text.trim().replace(/\s+/g, '_').slice(0, 300)
}

async function fetchSummary(title: string) {
  const started = Date.now()
  const cacheKey = `wikipedia:summary:${title}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/page/summary/${encodeURIComponent(title)}`
  const result = await safeProviderFetch(PROVIDER, url, { headers: { 'User-Agent': userAgent() }, timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, status: result.status }

  const data = safeJsonParse<PageSummary>(result.text)
  if (!data || typeof data !== 'object' || !data.title) {
    return { ok: false as const, status: null, malformed: true }
  }

  const canonicalUrl = data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`
  const documents = [
    makeDocument({
      id: `wikipedia:${data.pageid ?? title}`,
      provider: PROVIDER,
      providerRecordId: data.pageid ? String(data.pageid) : null,
      title: data.title,
      summary: data.extract ?? null,
      contentSnippet: data.description ?? data.extract ?? null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'Wikipedia',
      contentType: 'encyclopedia_article',
      authors: [],
      organization: 'Wikimedia Foundation',
      publishedAt: null,
      updatedAt: data.timestamp ?? null,
      geography: null,
      language: 'en',
      identifiers: data.pageid ? { wikipedia_page_id: String(data.pageid) } : {},
      subjects: [],
      license: 'CC BY-SA 4.0',
      accessStatus: 'open',
    }),
  ]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'WIKIMEDIA_USER_AGENT_BASE is not configured.')
  }
  const title = titleFromQuery(query.text)
  if (!title) return okResponse(PROVIDER, { documents: [], durationMs: 0 })
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchSummary(title)
      if (outcome.ok) return outcome.response
      if (outcome.status === 404) return okResponse(PROVIDER, { documents: [], durationMs: 0 })
      throw new Error(outcome.status ? `Wikipedia summary lookup failed with HTTP ${outcome.status}` : 'Wikipedia summary response was not a valid page object.')
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'WIKIMEDIA_USER_AGENT_BASE missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/page/summary/Earth`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'summary endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wikipediaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
