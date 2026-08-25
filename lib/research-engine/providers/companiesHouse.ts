import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'companies_house' as const
const BASE_URL = 'https://api.company-information.service.gov.uk'
const MAX_RESULTS = 20

type Company = { company_number?: string; title?: string; company_status?: string; company_type?: string; date_of_creation?: string; address_snippet?: string }
type SearchResponse = { items?: Company[] }

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY?.trim() ?? ''
  // HTTP Basic auth: API key as username, password left blank — the
  // documented Companies House convention (`curl -u {key}: ...`).
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `companies_house:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search/companies`)
  url.searchParams.set('q', text)
  url.searchParams.set('items_per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { Authorization: authHeader() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Companies House response "items" field was missing or not an array.' }
  }

  const documents = data.items
    .filter(company => company.company_number && company.title)
    .map(company => {
      const number = company.company_number as string
      const canonicalUrl = `https://find-and-update.company-information.service.gov.uk/company/${number}`
      return makeDocument({
        id: `companies_house:${number}`,
        provider: PROVIDER,
        providerRecordId: number,
        title: company.title as string,
        summary: company.address_snippet ?? null,
        contentSnippet: company.company_status ? `Status: ${company.company_status}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'UK Companies House',
        contentType: 'company_registry_record',
        authors: [],
        organization: null,
        publishedAt: company.date_of_creation ?? null,
        updatedAt: null,
        geography: 'UK',
        language: 'en',
        identifiers: { companies_house_number: number, ...(company.company_type ? { company_type: company.company_type } : {}) },
        subjects: [],
        license: 'Open Government Licence',
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
    return notConfiguredResponse(PROVIDER, 'COMPANIES_HOUSE_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Companies House search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'COMPANIES_HOUSE_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search/companies?q=test&items_per_page=1`, { headers: { Authorization: authHeader() }, timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const companiesHouseAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
