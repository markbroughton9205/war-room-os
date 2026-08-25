import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'endoflife' as const
const BASE_URL = 'https://endoflife.date/api'
const MAX_RESULTS = 20

type Cycle = { cycle?: string; releaseDate?: string; eol?: string | boolean; latest?: string; support?: string | boolean; lts?: boolean }

/** endoflife.date is product-slug-addressed, not free-text searchable — resolves a query against the cached full slug list (~380 entries, /api/all.json), same pattern as this codebase's eurostat/who_gho keyword-to-code adapters, but backed by the real full list instead of a small fixed table. */
async function resolveSlug(text: string): Promise<string | null> {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return null
  const cacheKey = 'endoflife:all_slugs'
  let slugs = cacheGet<string[]>(cacheKey)
  if (!slugs) {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/all.json`, { timeoutMs: 10_000 })
    if (!result.ok) return null
    const parsed = safeJsonParse<string[]>(result.text)
    if (!Array.isArray(parsed)) return null
    slugs = parsed
    cacheSet(cacheKey, slugs, CACHE_TTL.codelist)
  }
  if (slugs.includes(trimmed)) return trimmed
  return slugs.find(slug => slug.includes(trimmed) || trimmed.includes(slug)) ?? null
}

async function fetchProduct(query: ResearchQuery) {
  const started = Date.now()
  const slug = await resolveSlug(query.text)
  if (!slug) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 15, MAX_RESULTS))
  const cacheKey = `endoflife:product:${slug}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${encodeURIComponent(slug)}.json`, { timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const cycles = safeJsonParse<Cycle[]>(result.text)
  if (!Array.isArray(cycles)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'endoflife.date response was not a JSON array.' }
  }

  const canonicalUrl = `https://endoflife.date/${slug}`
  const documents = cycles
    .filter(c => c.cycle)
    .slice(0, limit)
    .map(c => makeDocument({
      id: `endoflife:${slug}:${c.cycle}`,
      provider: PROVIDER,
      providerRecordId: `${slug}:${c.cycle}`,
      title: `${slug} ${c.cycle}`,
      summary: typeof c.eol === 'string' ? `End of life: ${c.eol}` : c.eol === false ? 'No scheduled end of life' : null,
      contentSnippet: c.latest ? `Latest patch: ${c.latest}` : null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'endoflife.date',
      contentType: 'software_lifecycle_record',
      authors: [],
      organization: null,
      publishedAt: c.releaseDate ?? null,
      updatedAt: null,
      geography: null,
      language: 'en',
      identifiers: { product: slug, cycle: c.cycle as string, ...(typeof c.lts === 'boolean' ? { lts: String(c.lts) } : {}) },
      subjects: [],
      license: null,
      accessStatus: 'open',
    }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchProduct(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`endoflife.date fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/python.json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'product endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const endoflifeAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
