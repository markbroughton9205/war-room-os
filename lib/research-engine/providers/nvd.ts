import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nvd' as const
const BASE_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
const MAX_RESULTS = 20
const CVE_ID_PATTERN = /^CVE-\d{4}-\d{4,}$/i

type NvdCve = {
  id?: string
  published?: string
  lastModified?: string
  vulnStatus?: string
  descriptions?: { lang?: string; value?: string }[]
  metrics?: { cvssMetricV31?: { cvssData?: { baseScore?: number; baseSeverity?: string } }[]; cvssMetricV30?: { cvssData?: { baseScore?: number; baseSeverity?: string } }[] }
  cisaExploitAdd?: string
}
type NvdResponse = { totalResults?: number; vulnerabilities?: { cve?: NvdCve }[] }

function authHeaders(): Record<string, string> {
  const key = process.env.NVD_API_KEY?.trim()
  return key ? { apiKey: key } : {}
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `nvd:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  if (CVE_ID_PATTERN.test(text)) {
    url.searchParams.set('cveId', text.toUpperCase())
  } else if (text) {
    url.searchParams.set('keywordSearch', text)
  }
  url.searchParams.set('resultsPerPage', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: authHeaders(), timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<NvdResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.vulnerabilities)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NVD response "vulnerabilities" field was missing or not an array.' }
  }

  const documents = data.vulnerabilities
    .map(entry => entry.cve)
    .filter((cve): cve is NvdCve => Boolean(cve?.id))
    .map(cve => {
      const id = cve.id as string
      const canonicalUrl = `https://nvd.nist.gov/vuln/detail/${id}`
      const description = cve.descriptions?.find(d => d.lang === 'en')?.value ?? cve.descriptions?.[0]?.value ?? null
      const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData
      // Evidence class: NVD mirrors CISA KEV status inline via
      // `cisaExploitAdd` (non-null => CONFIRMED_EXPLOITED); otherwise a
      // record here just means VULNERABILITY_EXISTS — NVD has no
      // predicted-exploitability (EPSS) field of its own, never fabricated.
      const evidenceClass = cve.cisaExploitAdd ? 'CONFIRMED_EXPLOITED' : 'VULNERABILITY_EXISTS'
      return makeDocument({
        id: `nvd:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: id,
        summary: description,
        contentSnippet: description,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NVD',
        contentType: 'vulnerability_record',
        authors: [],
        organization: 'NIST',
        publishedAt: cve.published ?? null,
        updatedAt: cve.lastModified ?? null,
        geography: null,
        language: 'en',
        identifiers: {
          cve_id: id,
          evidence_class: evidenceClass,
          ...(cvss?.baseSeverity ? { cvss_severity: cvss.baseSeverity } : {}),
          ...(typeof cvss?.baseScore === 'number' ? { cvss_score: String(cvss.baseScore) } : {}),
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
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NVD search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?resultsPerPage=1`, { headers: authHeaders(), timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : result.status === 403 ? 'rate_limited' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'CVE endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nvdAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
