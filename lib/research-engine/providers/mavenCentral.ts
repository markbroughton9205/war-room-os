import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'maven_central' as const
const BASE_URL = 'https://search.maven.org/solrsearch/select'
const MAX_RESULTS = 20

type MavenDoc = { id?: string; g?: string; a?: string; latestVersion?: string; versionCount?: number; timestamp?: number; p?: string }
type MavenResponse = { response?: { numFound?: number; docs?: MavenDoc[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `maven_central:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('rows', String(limit))
  url.searchParams.set('wt', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<MavenResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.response?.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Maven Central response "response.docs" field was missing or not an array.' }
  }

  const documents = data.response!.docs!
    .filter(doc => doc.id && doc.g && doc.a)
    .map(doc => {
      const id = doc.id as string
      const canonicalUrl = `https://search.maven.org/artifact/${doc.g}/${doc.a}`
      return makeDocument({
        id: `maven_central:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: id,
        summary: doc.latestVersion ? `Latest version: ${doc.latestVersion}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Maven Central',
        contentType: 'software_package',
        authors: [],
        organization: doc.g ?? null,
        publishedAt: null,
        updatedAt: typeof doc.timestamp === 'number' ? new Date(doc.timestamp).toISOString() : null,
        geography: null,
        language: null,
        identifiers: { maven_group_id: doc.g as string, maven_artifact_id: doc.a as string, ...(doc.latestVersion ? { latest_version: doc.latestVersion } : {}) },
        subjects: doc.p ? [doc.p] : [],
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
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Maven Central search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=guava&rows=1&wt=json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const mavenCentralAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
