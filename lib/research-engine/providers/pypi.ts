import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'pypi' as const
const BASE_URL = 'https://pypi.org/pypi'

type PypiInfo = { name?: string; version?: string; summary?: string | null; author?: string | null; license?: string | null; project_url?: string | null; home_page?: string | null }
type PypiResponse = { info?: PypiInfo }

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const name = query.text.trim().slice(0, 100)
  if (!name) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `pypi:${name}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${encodeURIComponent(name)}/json`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 10_000 })
  if (result.status === 404) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PypiResponse>(result.text)
  const info = data?.info
  if (!info || !info.name) return { ok: false as const, kind: 'malformed' as const, message: 'PyPI response "info" field was missing or invalid.' }

  const canonicalUrl = info.project_url ?? `https://pypi.org/project/${info.name}/`
  const documents = [makeDocument({
    id: `pypi:${info.name}`,
    provider: PROVIDER,
    providerRecordId: info.name,
    title: info.name,
    summary: info.summary ?? null,
    contentSnippet: info.version ? `Latest version: ${info.version}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'PyPI',
    contentType: 'software_package',
    authors: info.author ? [info.author] : [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { pypi_package: info.name, ...(info.version ? { latest_version: info.version } : {}) },
    subjects: [],
    license: info.license ?? null,
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
      if (outcome.kind === 'http_error') throw new Error(`PyPI lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/requests/json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'package lookup reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const pypiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
