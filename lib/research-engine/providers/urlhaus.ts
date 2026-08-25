import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'urlhaus' as const
const BASE_URL = 'https://urlhaus-api.abuse.ch/v1'
const MAX_RESULTS = 20

type UhUrlEntry = { id?: string; url?: string; url_status?: string; date_added?: string; threat?: string; tags?: string[] | null; urlhaus_reference?: string }
type UhResponse = { query_status?: string; url_count?: string | number; urls?: UhUrlEntry[] }

function authKey(): string {
  return process.env.URLHAUS_AUTH_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const host = query.text.trim().slice(0, 250)
  if (!host) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `urlhaus:${host}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const body = new URLSearchParams({ host })
  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/host/`, {
    method: 'POST',
    headers: { 'Auth-Key': authKey(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeoutMs: 12_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<UhResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'URLhaus response was not a valid JSON object.' }
  }
  if (data.query_status !== 'ok' || !Array.isArray(data.urls)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const documents = data.urls
    .filter(entry => entry.id && entry.url)
    .slice(0, limit)
    .map(entry => {
      const id = entry.id as string
      const canonicalUrl = entry.urlhaus_reference ?? `https://urlhaus.abuse.ch/url/${id}/`
      return makeDocument({
        id: `urlhaus:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: entry.url as string,
        summary: entry.threat ? `Threat: ${entry.threat}` : null,
        contentSnippet: entry.url_status ? `Status: ${entry.url_status}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'URLhaus (abuse.ch)',
        contentType: 'malicious_url_record',
        authors: [],
        organization: null,
        publishedAt: entry.date_added ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        // Evidence class: COMMUNITY_REPORTED, distinct from
        // CONFIRMED_EXPLOITED/VULNERABILITY_EXISTS/PREDICTED_EXPLOITABILITY.
        identifiers: { urlhaus_id: id, evidence_class: 'COMMUNITY_REPORTED', ...(entry.url_status ? { url_status: entry.url_status } : {}) },
        subjects: entry.tags ?? [],
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
    return notConfiguredResponse(PROVIDER, 'URLHAUS_AUTH_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`URLhaus search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'URLHAUS_AUTH_KEY missing', durationMs: null }
  }
  try {
    const body = new URLSearchParams({ host: 'example.com' })
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/host/`, { method: 'POST', headers: { 'Auth-Key': authKey(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 8_000 })
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

export const urlhausAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
