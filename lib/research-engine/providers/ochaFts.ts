import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ocha_fts' as const
const BASE_URL = 'https://api.hpc.tools/v2/public/plan/year'
const MAX_RESULTS = 25
const YEAR_PATTERN = /^(19|20)\d{2}$/

type PlanVersion = { name?: string; shortName?: string; code?: string; startDate?: string; endDate?: string }
type PlanEntry = { id?: number | string; planVersion?: PlanVersion }
type PlanResponse = { data?: PlanEntry[] }

/** Query text is a 4-digit year (e.g. "2024") — OCHA FTS's plan-by-year listing. */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const year = query.text.trim()
  if (!YEAR_PATTERN.test(year)) {
    throw new Error('Query must be a 4-digit year (e.g. "2024") — OCHA FTS is queried by humanitarian response plan year.')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ocha_fts:${year}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${year}`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PlanResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OCHA FTS response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .slice(0, limit)
    .filter(entry => entry.id != null)
    .map(entry => {
      const id = String(entry.id)
      const version = entry.planVersion ?? {}
      const canonicalUrl = `https://fts.unocha.org/plans/${id}/summary`
      return makeDocument({
        id: `ocha_fts:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: version.name ?? version.shortName ?? `Response Plan ${id}`,
        summary: version.code ? `Plan code: ${version.code}` : null,
        contentSnippet: version.startDate && version.endDate ? `${version.startDate} to ${version.endDate}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OCHA Financial Tracking Service',
        contentType: 'humanitarian_response_plan',
        authors: [],
        organization: 'OCHA',
        publishedAt: version.startDate ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { ocha_plan_id: id },
        subjects: ['humanitarian_funding'],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`OCHA FTS search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/2024`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'plan-by-year endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ochaFtsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
