import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'npm_registry' as const
const BASE_URL = 'https://registry.npmjs.org'

type NpmPackage = {
  name?: string
  description?: string | null
  'dist-tags'?: { latest?: string }
  homepage?: string | null
  license?: string | { type?: string } | null
  time?: Record<string, string>
}

function licenseToString(license: NpmPackage['license']): string | null {
  if (typeof license === 'string') return license
  if (license && typeof license === 'object' && typeof license.type === 'string') return license.type
  return null
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const name = query.text.trim().slice(0, 100)
  if (!name) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `npm_registry:${name}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${encodeURIComponent(name)}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 10_000 })
  if (result.status === 404) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const pkg = safeJsonParse<NpmPackage>(result.text)
  if (!pkg || !pkg.name) return { ok: false as const, kind: 'malformed' as const, message: 'npm registry response was not a valid package object.' }

  const latest = pkg['dist-tags']?.latest ?? null
  const canonicalUrl = `https://www.npmjs.com/package/${pkg.name}`
  const documents = [makeDocument({
    id: `npm_registry:${pkg.name}`,
    provider: PROVIDER,
    providerRecordId: pkg.name,
    title: pkg.name,
    summary: pkg.description ?? null,
    contentSnippet: latest ? `Latest version: ${latest}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'npm',
    contentType: 'software_package',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: latest && pkg.time?.[latest] ? pkg.time[latest] : null,
    geography: null,
    language: null,
    identifiers: { npm_package: pkg.name, ...(latest ? { latest_version: latest } : {}) },
    subjects: [],
    license: licenseToString(pkg.license),
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
      if (outcome.kind === 'http_error') throw new Error(`npm registry lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/express`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'package lookup reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const npmRegistryAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
