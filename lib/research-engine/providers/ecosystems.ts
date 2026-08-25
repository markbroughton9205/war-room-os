import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ecosystems' as const
const BASE_URL = 'https://packages.ecosyste.ms/api/v1/registries'
const DEFAULT_REGISTRY = 'npmjs.org'
const QUERY_PATTERN = /^(?:([\w.-]+)\/)?([\w@/.-]+)$/

type PackageInfo = {
  name?: string
  ecosystem?: string
  description?: string
  homepage?: string
  repository_url?: string
  latest_release_number?: string
  versions_count?: number
}

/** Ecosyste.ms has no cross-registry free-text search — only a compound
 * registry/packageName lookup (confirmed live). Query text is
 * "[registry/]packageName", defaulting to npmjs.org. */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const match = QUERY_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be a package name, optionally "registry/packageName" (e.g. "npmjs.org/express" or just "express").')
  const registry = match[1] ?? DEFAULT_REGISTRY
  const packageName = match[2]
  const cacheKey = `ecosystems:${registry}:${packageName}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${encodeURIComponent(registry)}/packages/${encodeURIComponent(packageName)}`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PackageInfo>(result.text)
  if (!data?.name) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = data.repository_url ?? data.homepage ?? `https://packages.ecosyste.ms/registries/${registry}/packages/${packageName}`
  const documents = [makeDocument({
    id: `ecosystems:${registry}:${data.name}`,
    provider: PROVIDER,
    providerRecordId: `${registry}:${data.name}`,
    title: data.name,
    summary: data.description ?? null,
    contentSnippet: data.latest_release_number ? `Latest: ${data.latest_release_number}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Ecosyste.ms',
    contentType: 'software_package',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { ecosystems_registry: registry, package_name: data.name },
    subjects: data.ecosystem ? [data.ecosystem] : [],
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
      throw new Error(`Ecosyste.ms lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/npmjs.org/packages/express`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'packages endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ecosystemsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
