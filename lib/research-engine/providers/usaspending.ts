import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'usaspending' as const
const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'
const MAX_RESULTS = 20
// USAspending requires award_type_codes to come from exactly ONE group
// (confirmed live: a mixed contracts+grants+loans set is rejected with a
// 422). Fixed to the "contracts" group — the broadest single group and not
// caller-configurable, keeping every request bounded and predictable.
const AWARD_TYPE_CODES = ['A', 'B', 'C', 'D']

// USAspending's field keys are literally the caller-requested field names
// from the `fields` array, including embedded spaces (e.g. "Award ID", not
// Award_ID) — confirmed live; accessed below via bracket notation.
type AwardResult = {
  'Award ID'?: string
  'Recipient Name'?: string
  'Award Amount'?: number
  'Start Date'?: string
  'Awarding Agency'?: string
  generated_internal_id?: string
}
type SpendingResponse = { results?: AwardResult[] }

function trailingWindow(): { start: string; end: string } {
  const end = new Date()
  const start = new Date(end.getFullYear() - 5, end.getMonth(), end.getDate())
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `usaspending:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const { start, end } = trailingWindow()
  const body = JSON.stringify({
    filters: {
      keywords: [text],
      award_type_codes: AWARD_TYPE_CODES,
      time_period: [{ start_date: start, end_date: end }],
    },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Start Date', 'Awarding Agency', 'generated_internal_id'],
    sort: 'Award Amount',
    order: 'desc',
    limit,
  })

  const result = await safeProviderFetch(PROVIDER, SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SpendingResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'USAspending response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(row => row['Award ID'] || row.generated_internal_id)
    .map(row => {
      const awardId = (row['Award ID'] ?? row.generated_internal_id) as string
      const canonicalUrl = `https://www.usaspending.gov/award/${encodeURIComponent(row.generated_internal_id ?? awardId)}`
      return makeDocument({
        id: `usaspending:${awardId}`,
        provider: PROVIDER,
        providerRecordId: awardId,
        title: row['Recipient Name'] ? `${row['Recipient Name']} — ${awardId}` : awardId,
        summary: typeof row['Award Amount'] === 'number' ? `Award amount: $${row['Award Amount'].toLocaleString()}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'USAspending.gov',
        contentType: 'federal_spending_award',
        authors: [],
        organization: row['Awarding Agency'] ?? null,
        publishedAt: row['Start Date'] ?? null,
        updatedAt: null,
        geography: 'US',
        language: 'en',
        identifiers: { usaspending_award_id: awardId },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`USAspending search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const { start, end } = trailingWindow()
    const body = JSON.stringify({ filters: { keywords: ['research'], award_type_codes: AWARD_TYPE_CODES, time_period: [{ start_date: start, end_date: end }] }, fields: ['Award ID'], limit: 1 })
    const result = await safeProviderFetch(PROVIDER, SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'spending_by_award reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usaspendingAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
