import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'alienvault_otx' as const
const BASE_URL = 'https://otx.alienvault.com/api/v1'
const MAX_RESULTS = 20

type OtxPulse = { id?: string; name?: string; description?: string; author?: { username?: string }; created?: string; modified?: string; tags?: string[] }
type OtxSearchResponse = { results?: OtxPulse[]; count?: number }

function apiKey(): string {
  return process.env.OTX_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `alienvault_otx:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search/pulses`)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'X-OTX-API-KEY': apiKey() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OtxSearchResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'AlienVault OTX response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(pulse => pulse.id && pulse.name)
    .map(pulse => {
      const id = pulse.id as string
      const canonicalUrl = `https://otx.alienvault.com/pulse/${id}`
      return makeDocument({
        id: `alienvault_otx:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: pulse.name as string,
        summary: pulse.description ?? null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'AlienVault OTX',
        contentType: 'threat_intel_pulse',
        authors: pulse.author?.username ? [pulse.author.username] : [],
        organization: null,
        publishedAt: pulse.created ?? null,
        updatedAt: pulse.modified ?? null,
        geography: null,
        language: null,
        // Evidence class: OTX pulses are analyst/community-submitted, not
        // government-confirmed or model-predicted — distinct from
        // cisa_kev's CONFIRMED_EXPLOITED and epss's PREDICTED_EXPLOITABILITY.
        identifiers: { otx_pulse_id: id, evidence_class: 'COMMUNITY_REPORTED' },
        subjects: pulse.tags ?? [],
        license: null,
        accessStatus: 'unknown',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'OTX_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`AlienVault OTX search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'OTX_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search/pulses?q=test&limit=1`, { headers: { 'X-OTX-API-KEY': apiKey() }, timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'search/pulses endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const alienvaultOtxAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
