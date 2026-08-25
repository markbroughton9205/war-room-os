import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'deps_dev' as const
const BASE_URL = 'https://api.deps.dev/v3/systems'
const DEFAULT_SYSTEM = 'npm'
const QUERY_PATTERN = /^(?:([A-Za-z]+)\/)?([\w@/.-]+)$/

type VersionKey = { system?: string; name?: string; version?: string }
type VersionEntry = { versionKey?: VersionKey; publishedAt?: string; isDefault?: boolean; isDeprecated?: boolean }
type PackageResponse = { packageKey?: { system?: string; name?: string }; versions?: VersionEntry[] }

/** deps.dev has no free-text search — only a compound system/packageName
 * lookup (confirmed live). Query text is "[system/]packageName". */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const match = QUERY_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be a package name, optionally "system/packageName" (e.g. "npm/react" or just "react").')
  const system = (match[1] ?? DEFAULT_SYSTEM).toUpperCase()
  const packageName = match[2]
  const cacheKey = `deps_dev:${system}:${packageName}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${system}/packages/${encodeURIComponent(packageName)}`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PackageResponse>(result.text)
  if (!data?.packageKey?.name || !Array.isArray(data.versions)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const name = data.packageKey.name
  const defaultVersion = data.versions.find(v => v.isDefault) ?? data.versions[data.versions.length - 1]
  const canonicalUrl = `https://deps.dev/${system.toLowerCase()}/${encodeURIComponent(name)}`
  const documents = [makeDocument({
    id: `deps_dev:${system}:${name}`,
    provider: PROVIDER,
    providerRecordId: `${system}:${name}`,
    title: name,
    summary: `Ecosystem: ${system}`,
    contentSnippet: defaultVersion?.versionKey?.version ? `Latest version: ${defaultVersion.versionKey.version}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'deps.dev (Google Open Source Insights)',
    contentType: 'software_package',
    authors: [],
    organization: 'Google',
    publishedAt: defaultVersion?.publishedAt ?? null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { deps_dev_system: system, package_name: name },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`deps.dev lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/NPM/packages/react`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'packages endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const depsDevAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
