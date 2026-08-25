import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'crates_io' as const
const BASE_URL = 'https://crates.io/api/v1/crates'
const MAX_RESULTS = 20

type Crate = { name?: string; description?: string | null; max_version?: string; repository?: string | null; downloads?: number; updated_at?: string }
type CratesResponse = { crates?: Crate[] }

/** crates.io hard-blocks (HTTP 403) any request without a descriptive User-Agent — confirmed live, not just documented etiquette. */
function userAgent(): string {
  return process.env.CRATES_IO_USER_AGENT_BASE?.trim() || 'WarRoomResearchEngine/1.0 (research-engine@warroom.local)'
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `crates_io:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CratesResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.crates)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'crates.io response "crates" field was missing or not an array.' }
  }

  const documents = data.crates
    .filter(crate => crate.name)
    .map(crate => {
      const name = crate.name as string
      const canonicalUrl = `https://crates.io/crates/${name}`
      return makeDocument({
        id: `crates_io:${name}`,
        provider: PROVIDER,
        providerRecordId: name,
        title: name,
        summary: crate.description ?? null,
        contentSnippet: crate.max_version ? `Latest version: ${crate.max_version}` : null,
        canonicalUrl,
        sourceUrl: crate.repository ?? canonicalUrl,
        sourceName: 'crates.io',
        contentType: 'software_package',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: crate.updated_at ?? null,
        geography: null,
        language: null,
        identifiers: { crates_io_name: name, ...(crate.max_version ? { latest_version: crate.max_version } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`crates.io search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=serde&per_page=1`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : result.status === 403 ? 'authentication_failed' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cratesIoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
