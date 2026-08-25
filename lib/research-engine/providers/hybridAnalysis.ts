import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'hybrid_analysis' as const
// Confirmed live: www.hybrid-analysis.com 301-redirects to the bare domain
// — this adapter targets the real host directly.
const BASE_URL = 'https://hybrid-analysis.com/api/v2/search/terms'
const MAX_RESULTS = 25

// Auth mechanism (api-key header, real 403 "API key is missing" error)
// confirmed live. Free self-service key via account registration.
// Response body shape for a valid key not independently re-verified live
// (no key available this build).
type Result = { sha256?: string; submit_name?: string; verdict?: string; vx_family?: string; analysis_start_time?: string }
type SearchResponse = { result?: Result[]; count?: number }

function apiKey(): string {
  return process.env.HYBRID_ANALYSIS_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a filename, hash, or search term.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `hybrid_analysis:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const body = new URLSearchParams({ filename: text }).toString()
  const result = await safeProviderFetch(PROVIDER, BASE_URL, {
    method: 'POST',
    body,
    headers: { 'api-key': apiKey(), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Falcon Sandbox' },
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.result)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Hybrid Analysis response "result" field was missing or not an array.' }
  }

  const documents = data.result
    .slice(0, limit)
    .filter(r => typeof r.sha256 === 'string')
    .map(r => {
      const sha256 = r.sha256 as string
      const canonicalUrl = `https://www.hybrid-analysis.com/sample/${sha256}`
      return makeDocument({
        id: `hybrid_analysis:${sha256}`,
        provider: PROVIDER,
        providerRecordId: sha256,
        title: r.submit_name ?? sha256,
        summary: r.verdict ? `Verdict: ${r.verdict}` : null,
        contentSnippet: r.vx_family ? `Family: ${r.vx_family}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Hybrid Analysis (Falcon Sandbox)',
        contentType: 'malware_sample',
        authors: [],
        organization: 'CrowdStrike',
        publishedAt: r.analysis_start_time ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { sha256 },
        subjects: r.verdict ? [r.verdict] : [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'HYBRID_ANALYSIS_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Hybrid Analysis search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'HYBRID_ANALYSIS_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, {
      method: 'POST',
      body: new URLSearchParams({ filename: 'test.exe' }).toString(),
      headers: { 'api-key': apiKey(), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Falcon Sandbox' },
      timeoutMs: 10_000,
    })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const hybridAnalysisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
