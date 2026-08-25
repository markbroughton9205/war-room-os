import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'threatfox' as const
const BASE_URL = 'https://threatfox-api.abuse.ch/api/v1/'
const MAX_RESULTS = 20

type TfIoc = { id?: string; ioc?: string; ioc_type?: string; threat_type?: string; malware_printable?: string; confidence_level?: number; first_seen?: string; last_seen?: string; tags?: string[] | null }
type TfResponse = { query_status?: string; data?: TfIoc[] }

function authKey(): string {
  return process.env.THREATFOX_AUTH_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `threatfox:${text}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, BASE_URL, {
    method: 'POST',
    headers: { 'Auth-Key': authKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'search_ioc', search_term: text }),
    timeoutMs: 12_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<TfResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'ThreatFox response was not a valid JSON object.' }
  }
  if (data.query_status !== 'ok' || !Array.isArray(data.data)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const documents = data.data
    .filter(ioc => ioc.id && ioc.ioc)
    .slice(0, limit)
    .map(ioc => {
      const id = ioc.id as string
      const canonicalUrl = `https://threatfox.abuse.ch/ioc/${id}/`
      return makeDocument({
        id: `threatfox:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: `${ioc.ioc_type ?? 'IOC'}: ${ioc.ioc}`,
        summary: ioc.malware_printable ? `Associated malware: ${ioc.malware_printable}` : null,
        contentSnippet: ioc.threat_type ? `Threat type: ${ioc.threat_type}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ThreatFox (abuse.ch)',
        contentType: 'indicator_of_compromise',
        authors: [],
        organization: null,
        publishedAt: ioc.first_seen ?? null,
        updatedAt: ioc.last_seen ?? null,
        geography: null,
        language: null,
        // Evidence class: COMMUNITY_REPORTED, distinct from
        // CONFIRMED_EXPLOITED/VULNERABILITY_EXISTS/PREDICTED_EXPLOITABILITY.
        // confidence_level (0-100) is a separate community-scored field,
        // never conflated with the evidence class itself.
        identifiers: {
          threatfox_id: id,
          evidence_class: 'COMMUNITY_REPORTED',
          ...(ioc.ioc_type ? { ioc_type: ioc.ioc_type } : {}),
          ...(typeof ioc.confidence_level === 'number' ? { confidence_level: String(ioc.confidence_level) } : {}),
        },
        subjects: ioc.tags ?? [],
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
    return notConfiguredResponse(PROVIDER, 'THREATFOX_AUTH_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`ThreatFox search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'THREATFOX_AUTH_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, { method: 'POST', headers: { 'Auth-Key': authKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'search_ioc', search_term: 'test' }), timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'API reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const threatfoxAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
