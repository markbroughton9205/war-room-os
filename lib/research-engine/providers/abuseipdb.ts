import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'abuseipdb' as const
const BASE_URL = 'https://api.abuseipdb.com/api/v2/check'
const IP_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

// Auth mechanism (Key header, real 401 structured error) confirmed live.
// Free self-service key via account registration (1,000 checks/day).
// Response body shape for a valid key not independently re-verified live
// (no key available this build).
type CheckData = {
  ipAddress?: string
  abuseConfidenceScore?: number
  countryCode?: string
  isp?: string
  usageType?: string
  totalReports?: number
  lastReportedAt?: string | null
}
type CheckResponse = { data?: CheckData }

function apiKey(): string {
  return process.env.ABUSEIPDB_API_KEY?.trim() ?? ''
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const ip = query.text.trim()
  if (!IP_PATTERN.test(ip)) {
    throw new Error('Query must be an IPv4 address (e.g. "8.8.8.8").')
  }
  const cacheKey = `abuseipdb:${ip}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('ipAddress', ip)
  url.searchParams.set('maxAgeInDays', '90')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { Key: apiKey(), Accept: 'application/json' }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CheckResponse>(result.text)
  const info = data?.data
  if (!info?.ipAddress) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://www.abuseipdb.com/check/${info.ipAddress}`
  const documents = [makeDocument({
    id: `abuseipdb:${info.ipAddress}`,
    provider: PROVIDER,
    providerRecordId: info.ipAddress,
    title: `${info.ipAddress} — abuse confidence ${info.abuseConfidenceScore ?? 0}%`,
    summary: info.isp ? `ISP: ${info.isp}` : null,
    contentSnippet: typeof info.totalReports === 'number' ? `${info.totalReports} reports` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'AbuseIPDB',
    contentType: 'ip_reputation',
    authors: [],
    organization: 'AbuseIPDB',
    publishedAt: null,
    updatedAt: info.lastReportedAt ?? null,
    geography: info.countryCode ?? null,
    language: null,
    identifiers: { ip: info.ipAddress },
    subjects: info.usageType ? [info.usageType] : [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'ABUSEIPDB_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`AbuseIPDB lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'ABUSEIPDB_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?ipAddress=8.8.8.8`, { headers: { Key: apiKey(), Accept: 'application/json' }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'check endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const abuseipdbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
