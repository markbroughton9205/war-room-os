import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'sam_gov' as const
const BASE_URL = 'https://api.sam.gov/opportunities/v2'

const MAX_QUERY_TEXT_LENGTH = 200
const MAX_RESULTS = 20
const DEFAULT_WINDOW_DAYS = 90
const MAX_DATE_RANGE_DAYS = 365
const MS_PER_DAY = 86_400_000

type SamOpportunity = {
  noticeId?: string
  title?: string
  solicitationNumber?: string
  postedDate?: string
  type?: string
  active?: string
  typeOfSetAsideDescription?: string | null
  responseDeadLine?: string | null
  uiLink?: string
  naicsCode?: string
}
type SamSearchResponse = { totalRecords?: number; opportunitiesData?: SamOpportunity[] }

class SamGovError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

/**
 * Caller-supplied dateFrom/dateTo are rejected outright (never silently
 * corrected or swapped) when invalid, reversed, or spanning more than
 * MAX_DATE_RANGE_DAYS — matching the honest-rejection convention the
 * target-URL validator uses elsewhere in this codebase, since the shared
 * ResearchProviderError type has no dedicated "invalid_request" category.
 */
class SamGovDateRangeError extends Error {}

function apiKey(): string {
  return process.env.SAM_GOV_API_KEY?.trim() ?? ''
}

function toSamDate(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}/${date.getUTCFullYear()}`
}

/** Accepts a strict ISO `YYYY-MM-DD` caller date; returns null (never throws) for anything else. */
function parseCallerIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Resolves the caller's dateFrom/dateTo into a validated, bounded UTC window,
 * or throws SamGovDateRangeError. A caller-supplied value that fails to parse
 * is rejected outright — it is never silently treated as "not provided" and
 * defaulted. A resolved range with dateTo before dateFrom, or spanning more
 * than MAX_DATE_RANGE_DAYS, is also rejected rather than swapped or clamped,
 * so the final upstream request range can never silently exceed the cap.
 */
function resolveValidatedDateRange(query: ResearchQuery): { from: Date; to: Date } {
  if (query.dateFrom && !parseCallerIsoDate(query.dateFrom)) {
    throw new SamGovDateRangeError(`dateFrom "${query.dateFrom}" is not a valid YYYY-MM-DD date.`)
  }
  if (query.dateTo && !parseCallerIsoDate(query.dateTo)) {
    throw new SamGovDateRangeError(`dateTo "${query.dateTo}" is not a valid YYYY-MM-DD date.`)
  }

  const now = new Date()
  const to = parseCallerIsoDate(query.dateTo) ?? now
  const from = parseCallerIsoDate(query.dateFrom) ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY)

  if (from.getTime() > to.getTime()) {
    throw new SamGovDateRangeError(`dateFrom (${query.dateFrom}) must not be later than dateTo (${query.dateTo}).`)
  }
  const rangeDays = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    throw new SamGovDateRangeError(`Requested date range spans ${rangeDays} days, exceeding the maximum allowed ${MAX_DATE_RANGE_DAYS} days.`)
  }

  return { from, to }
}

function normalizeOpportunity(opp: SamOpportunity) {
  const noticeId = opp.noticeId ?? null
  const title = opp.title?.trim() || 'Untitled opportunity'
  const canonicalUrl = opp.uiLink ?? null

  return makeDocument({
    id: `sam_gov:${noticeId ?? title}`,
    provider: PROVIDER,
    providerRecordId: noticeId,
    title,
    summary: null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'SAM.gov',
    contentType: 'government_opportunity',
    authors: [],
    organization: null,
    publishedAt: opp.postedDate ?? null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: {
      ...(noticeId ? { sam_gov_notice_id: noticeId } : {}),
      ...(opp.solicitationNumber ? { sam_gov_solicitation_number: opp.solicitationNumber } : {}),
      ...(opp.naicsCode ? { sam_gov_naics_code: opp.naicsCode } : {}),
      // Active/set-aside status is only recorded when the provider itself
      // supplies it — never inferred, never defaulted to active/eligible.
      ...(opp.active ? { sam_gov_active: opp.active } : {}),
      ...(opp.typeOfSetAsideDescription ? { sam_gov_set_aside: opp.typeOfSetAsideDescription } : {}),
      ...(opp.responseDeadLine ? { sam_gov_response_deadline: opp.responseDeadLine } : {}),
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const title = query.text.trim().slice(0, MAX_QUERY_TEXT_LENGTH)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))

  const { from: postedFrom, to: postedTo } = resolveValidatedDateRange(query)

  const cacheKey = `sam_gov:${title}:${toSamDate(postedFrom)}:${toSamDate(postedTo)}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search`)
  url.searchParams.set('api_key', apiKey())
  url.searchParams.set('postedFrom', toSamDate(postedFrom))
  url.searchParams.set('postedTo', toSamDate(postedTo))
  if (title) url.searchParams.set('title', title)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', '0')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<SamSearchResponse>(result.text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SAM.gov response was not a valid JSON object.' }
  }
  if (!Array.isArray(parsed.opportunitiesData)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SAM.gov response "opportunitiesData" field was missing or not an array.' }
  }

  const rows = parsed.opportunitiesData.slice(0, MAX_RESULTS)
  const documents = rows.map(normalizeOpportunity)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'SAM_GOV_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new SamGovError(`SAM.gov search failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new SamGovError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof SamGovDateRangeError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: 'unknown', message: error.message, httpStatus: null }, 0)
    }
    if (error instanceof SamGovError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'SAM_GOV_API_KEY missing', durationMs: null }
  }
  try {
    const now = new Date()
    const from = new Date(now.getTime() - 7 * 86_400_000)
    const url = `${BASE_URL}/search?api_key=${encodeURIComponent(apiKey())}&postedFrom=${toSamDate(from)}&postedTo=${toSamDate(now)}&limit=1`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 8_000 })
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

export const samGovAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
