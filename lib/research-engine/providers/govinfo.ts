import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'govinfo' as const
const BASE_URL = 'https://api.govinfo.gov'
const MAX_RESULTS = 20
const KNOWN_COLLECTIONS = new Set(['BILLS', 'FR', 'CFR', 'USCOURTS', 'PLAW', 'STATUTE'])
const DEFAULT_COLLECTION = 'FR' // Federal Register — high-volume, broadly relevant default

function apiKey(): string {
  return process.env.GOVINFO_API_KEY?.trim() ?? ''
}

type GovinfoPackage = { packageId?: string; title?: string; dateIssued?: string; lastModified?: string; packageLink?: string; docClass?: string }
type GovinfoCollectionResponse = { packages?: GovinfoPackage[] }

function resolveCollection(text: string): string {
  const upper = text.trim().toUpperCase()
  return KNOWN_COLLECTIONS.has(upper) ? upper : DEFAULT_COLLECTION
}

/**
 * The `/collections/{code}/{date}` endpoint requires a start date; this
 * adapter always uses a fixed 30-day trailing window rather than accepting
 * caller-supplied dates, keeping every request bounded regardless of input.
 */
function trailingWindowStart(): string {
  const date = new Date(Date.now() - 30 * 86_400_000)
  return date.toISOString().slice(0, 19) + 'Z'
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const collection = resolveCollection(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const startDate = trailingWindowStart()
  const cacheKey = `govinfo:${collection}:${startDate}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/collections/${collection}/${startDate}`)
  url.searchParams.set('pageSize', String(limit))
  url.searchParams.set('api_key', apiKey())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GovinfoCollectionResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.packages)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'GovInfo response "packages" field was missing or not an array.' }
  }

  const documents = data.packages
    .filter(pkg => pkg.packageId)
    .slice(0, limit)
    .map(pkg => {
      const id = pkg.packageId as string
      const canonicalUrl = `https://www.govinfo.gov/app/details/${id}`
      return makeDocument({
        id: `govinfo:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: pkg.title ?? id,
        summary: pkg.docClass ? `Document class: ${pkg.docClass}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: pkg.packageLink ?? canonicalUrl,
        sourceName: 'GovInfo (US GPO)',
        contentType: 'government_publication',
        authors: [],
        organization: 'US Government Publishing Office',
        publishedAt: pkg.dateIssued ?? null,
        updatedAt: pkg.lastModified ?? null,
        geography: 'US',
        language: 'en',
        identifiers: { govinfo_package_id: id, collection },
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
    return notConfiguredResponse(PROVIDER, 'GOVINFO_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`GovInfo search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'GOVINFO_API_KEY missing', durationMs: null }
  }
  try {
    const url = `${BASE_URL}/collections/${DEFAULT_COLLECTION}/${trailingWindowStart()}?pageSize=1&api_key=${encodeURIComponent(apiKey())}`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 10_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'collections endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const govinfoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
