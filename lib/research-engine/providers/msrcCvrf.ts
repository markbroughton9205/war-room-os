import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'msrc_cvrf' as const
const BASE_URL = 'https://api.msrc.microsoft.com/cvrf/v3.0'
const UPDATE_ID_PATTERN = /^\d{4}-[A-Za-z]{3}$/

type Cwe = { ID?: string; Value?: string }
type Vulnerability = { Title?: { Value?: string }; CVE?: string; CWE?: Cwe[] }
type CvrfResponse = { DocumentTitle?: { Value?: string } | string; Vulnerability?: Vulnerability[] }

/** MSRC CVRF is a lookup-by-monthly-update-ID API, not free-text search
 * (confirmed live). Query text must be a month tag like "2024-Jan". */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const updateId = query.text.trim()
  if (!UPDATE_ID_PATTERN.test(updateId)) {
    throw new Error('Query must be an MSRC monthly update ID (e.g. "2024-Jan").')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `msrc_cvrf:${updateId}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/cvrf/${updateId}`, { timeoutMs: 15_000, headers: { Accept: 'application/json' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CvrfResponse>(result.text)
  if (!data || !Array.isArray(data.Vulnerability)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'MSRC CVRF response "Vulnerability" field was missing or not an array.' }
  }

  const documentTitle = typeof data.DocumentTitle === 'string' ? data.DocumentTitle : data.DocumentTitle?.Value
  const documents = data.Vulnerability
    .slice(0, limit)
    .filter(v => typeof v.CVE === 'string')
    .map(v => {
      const cve = v.CVE as string
      const canonicalUrl = `https://msrc.microsoft.com/update-guide/vulnerability/${cve}`
      return makeDocument({
        id: `msrc_cvrf:${cve}`,
        provider: PROVIDER,
        providerRecordId: cve,
        title: v.Title?.Value ?? cve,
        summary: documentTitle ?? null,
        contentSnippet: v.CWE?.length ? `CWE: ${v.CWE.map(c => c.ID).filter(Boolean).join(', ')}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Microsoft Security Response Center',
        contentType: 'security_advisory',
        authors: [],
        organization: 'Microsoft',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { cve, msrc_update_id: updateId },
        subjects: v.CWE?.map(c => c.ID).filter((v2): v2 is string => !!v2) ?? [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`MSRC CVRF lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/updates`, { timeoutMs: 10_000, headers: { Accept: 'application/json' } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'updates endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const msrcCvrfAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
