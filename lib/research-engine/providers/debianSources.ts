import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'debian_sources' as const
const BASE_URL = 'https://sources.debian.org/api/src'
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9.+-]*$/

type VersionEntry = { area?: string; suites?: string[]; version?: string }
type PackageResponse = { package?: string; path?: string; error?: number; versions?: VersionEntry[] }

/** Debian Sources is an exact-package-name lookup, not free-text search
 * (confirmed live). Query text must be a real Debian source package name. */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const pkg = query.text.trim().toLowerCase()
  if (!PACKAGE_NAME_PATTERN.test(pkg)) {
    throw new Error('Query must be a Debian source package name (e.g. "curl", "linux"), lowercase alphanumeric with . + -.')
  }
  const cacheKey = `debian_sources:${pkg}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${pkg}/`, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PackageResponse>(result.text)
  if (!data || data.error === 404 || !Array.isArray(data.versions)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://sources.debian.org/src/${pkg}/`
  const documents = data.versions.slice(0, 25).map(v => {
    const version = v.version ?? 'unknown'
    return makeDocument({
      id: `debian_sources:${pkg}:${version}`,
      provider: PROVIDER,
      providerRecordId: `${pkg}:${version}`,
      title: `${pkg} ${version}`,
      summary: v.suites?.length ? `Suites: ${v.suites.join(', ')}` : null,
      contentSnippet: v.area ?? null,
      canonicalUrl: `${canonicalUrl}${version}/`,
      sourceUrl: `${canonicalUrl}${version}/`,
      sourceName: 'Debian Sources',
      contentType: 'source_package_version',
      authors: [],
      organization: 'Debian Project',
      publishedAt: null,
      updatedAt: null,
      geography: null,
      language: null,
      identifiers: { debian_package: pkg, debian_version: version },
      subjects: v.suites ?? [],
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
      throw new Error(`Debian Sources lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/curl/`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'package lookup endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const debianSourcesAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
