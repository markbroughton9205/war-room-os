import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'congress_gov' as const
const BASE_URL = 'https://api.congress.gov/v3'
const MAX_RESULTS = 20

type CongressBill = {
  congress?: number
  number?: string
  type?: string
  title?: string
  updateDate?: string
  originChamber?: string
  latestAction?: { actionDate?: string; text?: string }
}
type CongressBillsResponse = { bills?: CongressBill[] }

function apiKey(): string {
  return process.env.CONGRESS_GOV_API_KEY?.trim() ?? ''
}

/**
 * Congress.gov's bill list endpoint has no free-text query parameter — it
 * lists recent bills, optionally scoped to a congress number. Query text
 * "118" (a congress number) narrows the list; anything else lists the most
 * recent bills across all congresses, and the query text is used only for
 * client-side title filtering afterward.
 */
async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const congressMatch = /^\d{2,3}$/.exec(text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `congress_gov:bills:${congressMatch ? congressMatch[0] : 'recent'}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(congressMatch ? `${BASE_URL}/bill/${congressMatch[0]}` : `${BASE_URL}/bill`)
  url.searchParams.set('api_key', apiKey())
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CongressBillsResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.bills)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Congress.gov response "bills" field was missing or not an array.' }
  }

  const titleFilter = !congressMatch && text ? text.toLowerCase() : null
  const documents = data.bills
    .filter(bill => bill.congress && bill.type && bill.number)
    .filter(bill => !titleFilter || (bill.title ?? '').toLowerCase().includes(titleFilter))
    .map(bill => {
      const recordId = `${bill.congress}-${String(bill.type).toLowerCase()}-${bill.number}`
      const canonicalUrl = `https://www.congress.gov/bill/${bill.congress}th-congress/${String(bill.type).toLowerCase()}/${bill.number}`
      return makeDocument({
        id: `congress_gov:${recordId}`,
        provider: PROVIDER,
        providerRecordId: recordId,
        title: bill.title ?? recordId,
        summary: bill.latestAction?.text ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Congress.gov',
        contentType: 'legislation',
        authors: [],
        organization: bill.originChamber ?? null,
        publishedAt: null,
        updatedAt: bill.updateDate ?? null,
        geography: 'US',
        language: 'en',
        identifiers: { congress_bill_id: recordId },
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
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'CONGRESS_GOV_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Congress.gov search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'CONGRESS_GOV_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/bill?api_key=${encodeURIComponent(apiKey())}&format=json&limit=1`, { timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'bill list reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const congressGovAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
