import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'pride_archive' as const
const BASE_URL = 'https://www.ebi.ac.uk/pride/ws/archive/v2/search/projects'
const MAX_RESULTS = 25

type Project = {
  accession?: string
  title?: string
  projectDescription?: string
  publicationDate?: string
  updatedDate?: string
  organisms?: string[]
  diseases?: string[]
  instruments?: string[]
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `pride_archive:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('keyword', text)
  url.searchParams.set('pageSize', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Project[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'PRIDE Archive response was not a JSON array.' }
  }

  const documents = data
    .filter(p => typeof p.accession === 'string')
    .map(p => {
      const accession = p.accession as string
      const canonicalUrl = `https://www.ebi.ac.uk/pride/archive/projects/${accession}`
      return makeDocument({
        id: `pride_archive:${accession}`,
        provider: PROVIDER,
        providerRecordId: accession,
        title: p.title ?? accession,
        summary: p.projectDescription ?? null,
        contentSnippet: p.instruments?.length ? `Instruments: ${p.instruments.join(', ')}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'PRIDE Archive',
        contentType: 'proteomics_dataset',
        authors: [],
        organization: 'EMBL-EBI',
        publishedAt: p.publicationDate ?? null,
        updatedAt: p.updatedDate ?? null,
        geography: null,
        language: 'en',
        identifiers: { pride_accession: accession },
        subjects: [...(p.organisms ?? []), ...(p.diseases ?? [])],
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
      if (outcome.kind === 'http_error') throw new Error(`PRIDE Archive search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?keyword=cancer&pageSize=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const prideArchiveAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
