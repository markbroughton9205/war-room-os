import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ror' as const
const BASE_URL = 'https://api.ror.org/v2/organizations'
const MAX_RESULTS = 20

type RorName = { value?: string; lang?: string | null; types?: string[] }
type RorLink = { type?: string; value?: string }
type RorOrg = { id?: string; names?: RorName[]; links?: RorLink[]; established?: number | null }
type RorResponse = { number_of_results?: number; items?: RorOrg[] }

function displayName(org: RorOrg): string | null {
  const display = org.names?.find(n => n.types?.includes('ror_display'))
  return display?.value ?? org.names?.[0]?.value ?? null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ror:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('query', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<RorResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ROR response "items" field was missing or not an array.' }
  }

  const documents = data.items
    .filter(org => org.id)
    .slice(0, limit)
    .map(org => {
      const id = org.id as string
      const websiteLink = org.links?.find(l => l.type === 'website')?.value ?? null
      return makeDocument({
        id: `ror:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: displayName(org) ?? id,
        summary: org.established ? `Established ${org.established}` : null,
        contentSnippet: null,
        canonicalUrl: id,
        sourceUrl: websiteLink ?? id,
        sourceName: 'Research Organization Registry (ROR)',
        contentType: 'research_organization',
        authors: [],
        organization: null,
        publishedAt: org.established ? String(org.established) : null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { ror_id: id },
        subjects: [],
        license: 'CC0',
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
      if (outcome.kind === 'http_error') throw new Error(`ROR search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?query=Stanford`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'organizations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const rorAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
