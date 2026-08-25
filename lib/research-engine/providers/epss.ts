import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'epss' as const
const BASE_URL = 'https://api.first.org/data/v1/epss'
const MAX_RESULTS = 20
const CVE_ID_PATTERN = /^CVE-\d{4}-\d{4,}$/i

type EpssRow = { cve?: string; epss?: string; percentile?: string; date?: string }
type EpssResponse = { data?: EpssRow[] }

/** Query text is one CVE ID, or a comma-separated batch of up to MAX_RESULTS CVE IDs. */
function parseCveIds(text: string): string[] {
  return text
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => CVE_ID_PATTERN.test(s))
    .slice(0, MAX_RESULTS)
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const cveIds = parseCveIds(query.text)
  if (cveIds.length === 0) {
    throw new Error('Query must be one or more comma-separated CVE IDs (e.g. "CVE-2021-44228").')
  }
  const cacheKey = `epss:${cveIds.join(',')}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}?cve=${encodeURIComponent(cveIds.join(','))}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<EpssResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'EPSS response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(row => row.cve && row.epss)
    .map(row => {
      const cve = row.cve as string
      const canonicalUrl = `https://nvd.nist.gov/vuln/detail/${cve}`
      // epss/percentile are decimal strings per FIRST's API, never assumed numeric without parsing.
      const epssScore = Number(row.epss)
      const percentile = row.percentile ? Number(row.percentile) : null
      return makeDocument({
        id: `epss:${cve}:${row.date ?? 'latest'}`,
        provider: PROVIDER,
        providerRecordId: cve,
        title: `${cve} — EPSS ${Number.isFinite(epssScore) ? (epssScore * 100).toFixed(2) : row.epss}% predicted exploitability`,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'FIRST EPSS',
        contentType: 'exploit_prediction_score',
        authors: [],
        organization: 'FIRST.org',
        publishedAt: row.date ?? null,
        updatedAt: row.date ?? null,
        geography: null,
        language: null,
        // Evidence class: every EPSS record is, by definition,
        // PREDICTED_EXPLOITABILITY — a probability model output, never
        // conflated with cisa_kev's CONFIRMED_EXPLOITED or osv_dev's
        // VULNERABILITY_EXISTS.
        identifiers: {
          cve_id: cve,
          evidence_class: 'PREDICTED_EXPLOITABILITY',
          epss_score: row.epss as string,
          ...(percentile !== null ? { epss_percentile: row.percentile as string } : {}),
        },
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
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`EPSS lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?cve=CVE-2021-44228`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'EPSS endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const epssAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
