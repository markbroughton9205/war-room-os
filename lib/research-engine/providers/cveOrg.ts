import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cve_org' as const
// The real API host is cveawg.mitre.org — www.cve.org/api/... is only the
// SPA's static HTML shell (confirmed live), not a working API host.
const BASE_URL = 'https://cveawg.mitre.org/api/cve'
const CVE_ID_PATTERN = /^CVE-\d{4}-\d{4,}$/i

type Description = { lang?: string; value?: string }
type CnaContainer = { title?: string; descriptions?: Description[]; datePublic?: string }
type CveMetadata = { cveId?: string; state?: string; datePublished?: string; assignerShortName?: string }
type CveRecord = { cveMetadata?: CveMetadata; containers?: { cna?: CnaContainer } }

/** CVE.org is a lookup-by-CVE-ID API, not free-text search (confirmed live). */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const cveId = query.text.trim().toUpperCase()
  if (!CVE_ID_PATTERN.test(cveId)) {
    throw new Error('Query must be a CVE ID (e.g. "CVE-2021-44228").')
  }
  const cacheKey = `cve_org:${cveId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${cveId}`, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CveRecord>(result.text)
  const metadata = data?.cveMetadata
  if (!metadata?.cveId) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const cna = data?.containers?.cna
  const description = cna?.descriptions?.find(d => d.lang?.startsWith('en'))?.value ?? cna?.descriptions?.[0]?.value ?? null
  const canonicalUrl = `https://www.cve.org/CVERecord?id=${metadata.cveId}`
  const documents = [makeDocument({
    id: `cve_org:${metadata.cveId}`,
    provider: PROVIDER,
    providerRecordId: metadata.cveId,
    title: cna?.title ?? metadata.cveId,
    summary: description,
    contentSnippet: `State: ${metadata.state ?? 'unknown'}`,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'CVE.org',
    contentType: 'vulnerability_record',
    authors: [],
    organization: metadata.assignerShortName ?? 'MITRE',
    publishedAt: metadata.datePublished ?? null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { cve: metadata.cveId },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`CVE.org lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/CVE-2021-44228`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'CVE record endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cveOrgAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
