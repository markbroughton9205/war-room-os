import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nasa' as const
const BASE_URL = 'https://api.nasa.gov'

const MAX_RESULTS = 20
const MAX_DATE_RANGE_DAYS = 7

type NeoCloseApproach = { close_approach_date?: string }
type NeoObject = {
  id?: string
  neo_reference_id?: string
  name?: string
  nasa_jpl_url?: string
  close_approach_data?: NeoCloseApproach[]
}
type NeoFeedResponse = { near_earth_objects?: Record<string, NeoObject[]> }

class NasaError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function apiKey(): string {
  return process.env.NASA_API_KEY?.trim() ?? ''
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseCallerIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeNeo(neo: NeoObject) {
  const id = neo.id ?? neo.neo_reference_id ?? null
  const title = neo.name?.trim() || 'Unnamed near-Earth object'
  const closestApproach = neo.close_approach_data?.[0]?.close_approach_date ?? null

  return makeDocument({
    id: `nasa:neo:${id ?? title}`,
    provider: PROVIDER,
    providerRecordId: neo.neo_reference_id ?? id,
    title,
    summary: null,
    contentSnippet: null,
    canonicalUrl: neo.nasa_jpl_url ?? null,
    sourceUrl: neo.nasa_jpl_url ?? null,
    sourceName: 'NASA NeoWs',
    contentType: 'near_earth_object',
    authors: [],
    organization: 'NASA',
    // Only the nearest documented approach date is surfaced; never fabricated when absent.
    publishedAt: closestApproach,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: neo.neo_reference_id ? { nasa_neo_reference_id: neo.neo_reference_id } : {},
    subjects: [],
    license: null,
    accessStatus: 'open',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const now = new Date()
  const startDate = parseCallerIsoDate(query.dateFrom) ?? now
  let endDate = parseCallerIsoDate(query.dateTo) ?? new Date(startDate.getTime() + MAX_DATE_RANGE_DAYS * 86_400_000)
  // Clamp to the documented ≤7-day maximum range regardless of caller input.
  if (endDate.getTime() - startDate.getTime() > MAX_DATE_RANGE_DAYS * 86_400_000) {
    endDate = new Date(startDate.getTime() + MAX_DATE_RANGE_DAYS * 86_400_000)
  }
  if (endDate.getTime() < startDate.getTime()) {
    endDate = startDate
  }

  const cacheKey = `nasa:neo_feed:${isoDate(startDate)}:${isoDate(endDate)}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/neo/rest/v1/feed`)
  url.searchParams.set('start_date', isoDate(startDate))
  url.searchParams.set('end_date', isoDate(endDate))
  url.searchParams.set('api_key', apiKey())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<NeoFeedResponse>(result.text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NASA NeoWs response was not a valid JSON object.' }
  }
  if (!parsed.near_earth_objects || typeof parsed.near_earth_objects !== 'object' || Array.isArray(parsed.near_earth_objects)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NASA NeoWs response "near_earth_objects" field was missing or not an object.' }
  }

  const neos = Object.values(parsed.near_earth_objects)
    .filter((entry): entry is NeoObject[] => Array.isArray(entry))
    .flat()
    .slice(0, MAX_RESULTS)
  const documents = neos.map(normalizeNeo)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'NASA_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new NasaError(`NASA NeoWs feed failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new NasaError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof NasaError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'NASA_API_KEY missing', durationMs: null }
  }
  try {
    const today = isoDate(new Date())
    const url = `${BASE_URL}/neo/rest/v1/feed?start_date=${today}&end_date=${today}&api_key=${encodeURIComponent(apiKey())}`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'feed endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nasaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
