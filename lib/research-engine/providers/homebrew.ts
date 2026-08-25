import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'homebrew' as const
const BASE_URL = 'https://formulae.brew.sh/api/formula'
const NAME_PATTERN = /^[a-z0-9][a-z0-9@._+-]*$/i

type Versions = { stable?: string }
type Formula = { name?: string; full_name?: string; desc?: string; license?: string; homepage?: string; versions?: Versions }

/** Homebrew's JSON API is a static per-formula file, not a search endpoint
 * (confirmed live) — query text must be an exact formula name. */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const name = query.text.trim().toLowerCase()
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Query must be an exact Homebrew formula name (e.g. "wget").')
  }
  const cacheKey = `homebrew:${name}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${name}.json`, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Formula>(result.text)
  if (!data?.name) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = data.homepage ?? `https://formulae.brew.sh/formula/${data.name}`
  const documents = [makeDocument({
    id: `homebrew:${data.name}`,
    provider: PROVIDER,
    providerRecordId: data.name,
    title: data.full_name ?? data.name,
    summary: data.desc ?? null,
    contentSnippet: data.versions?.stable ? `Version: ${data.versions.stable}` : null,
    canonicalUrl,
    sourceUrl: `https://formulae.brew.sh/formula/${data.name}`,
    sourceName: 'Homebrew',
    contentType: 'software_package',
    authors: [],
    organization: 'Homebrew',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { homebrew_formula: data.name },
    subjects: [],
    license: data.license ?? null,
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
      throw new Error(`Homebrew lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/wget.json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'formula endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const homebrewAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
