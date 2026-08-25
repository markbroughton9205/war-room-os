import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'intact' as const
const BASE_URL = 'https://www.ebi.ac.uk/intact/ws/interactor/findInteractor'
const MAX_RESULTS = 25

type Interactor = {
  interactorAc?: string
  interactorName?: string
  interactorPreferredIdentifier?: string
  interactorDescription?: string
  interactorType?: string
  interactorSpecies?: string
  interactionCount?: number
}
type SearchResponse = { content?: Interactor[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a protein/gene name or identifier (e.g. "TP53").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `intact:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${encodeURIComponent(text)}`)
  url.searchParams.set('page', '0')
  url.searchParams.set('pageSize', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.content)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'IntAct response "content" field was missing or not an array.' }
  }

  const documents = data.content
    .filter(item => typeof item.interactorAc === 'string')
    .map(item => {
      const ac = item.interactorAc as string
      const canonicalUrl = `https://www.ebi.ac.uk/intact/search?query=${encodeURIComponent(ac)}`
      return makeDocument({
        id: `intact:${ac}`,
        provider: PROVIDER,
        providerRecordId: ac,
        title: item.interactorName ?? ac,
        summary: item.interactorDescription ?? null,
        contentSnippet: typeof item.interactionCount === 'number' ? `${item.interactionCount} known interactions` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'IntAct Molecular Interaction Database',
        contentType: 'molecular_interactor',
        authors: [],
        organization: 'EMBL-EBI',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { intact_ac: ac, ...(item.interactorPreferredIdentifier ? { preferred_identifier: item.interactorPreferredIdentifier } : {}) },
        subjects: [item.interactorType, item.interactorSpecies].filter((v): v is string => !!v),
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
      if (outcome.kind === 'http_error') throw new Error(`IntAct search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/TP53?page=0&pageSize=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'interactor search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const intactAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
