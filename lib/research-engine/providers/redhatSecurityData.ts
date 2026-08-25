import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'redhat_security_data' as const
const BASE_URL = 'https://access.redhat.com/hydra/rest/securitydata'
const MAX_RESULTS = 25

type CveEntry = {
  CVE?: string
  severity?: string
  public_date?: string
  bugzilla_description?: string
  cvss_score?: string | number
  cvss3_score?: string | number
  resource_url?: string
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const pkg = query.text.trim().slice(0, 100)
  if (!pkg) throw new Error('Query must be a package name (e.g. "openssl") or CVE ID.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `redhat_security_data:${pkg}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/cve.json`)
  url.searchParams.set('package', pkg)
  url.searchParams.set('per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CveEntry[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Red Hat Security Data response was not a JSON array.' }
  }

  const documents = data
    .filter(entry => typeof entry.CVE === 'string')
    .map(entry => {
      const cve = entry.CVE as string
      const canonicalUrl = `https://access.redhat.com/security/cve/${cve}`
      const score = entry.cvss3_score ?? entry.cvss_score
      return makeDocument({
        id: `redhat_security_data:${cve}`,
        provider: PROVIDER,
        providerRecordId: cve,
        title: cve,
        summary: entry.bugzilla_description ?? null,
        contentSnippet: `Severity: ${entry.severity ?? 'unknown'}${score ? `, CVSS: ${score}` : ''}`,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Red Hat Security Data',
        contentType: 'security_advisory',
        authors: [],
        organization: 'Red Hat',
        publishedAt: entry.public_date ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { cve, package: pkg },
        subjects: entry.severity ? [entry.severity] : [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Red Hat Security Data search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/cve.json?package=openssl&per_page=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'cve search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const redhatSecurityDataAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
