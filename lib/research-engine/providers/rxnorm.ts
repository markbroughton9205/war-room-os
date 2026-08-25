import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'rxnorm' as const
const BASE_URL = 'https://rxnav.nlm.nih.gov/REST'
const MAX_RESULTS = 20

type ConceptProperty = { rxcui?: string; name?: string; synonym?: string; tty?: string }
type ConceptGroup = { tty?: string; conceptProperties?: ConceptProperty[] }
type DrugsResponse = { drugGroup?: { conceptGroup?: ConceptGroup[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `rxnorm:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/drugs.json?name=${encodeURIComponent(text)}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<DrugsResponse>(result.text)
  const groups = data?.drugGroup?.conceptGroup
  if (!Array.isArray(groups)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  // Flatten conceptGroup[].conceptProperties[] into one bounded, deduplicated list.
  const seen = new Set<string>()
  const flat: ConceptProperty[] = []
  for (const group of groups) {
    for (const prop of group.conceptProperties ?? []) {
      if (!prop.rxcui || seen.has(prop.rxcui)) continue
      seen.add(prop.rxcui)
      flat.push(prop)
      if (flat.length >= limit) break
    }
    if (flat.length >= limit) break
  }

  const documents = flat.map(prop => {
    const rxcui = prop.rxcui as string
    const canonicalUrl = `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${rxcui}`
    return makeDocument({
      id: `rxnorm:${rxcui}`,
      provider: PROVIDER,
      providerRecordId: rxcui,
      title: prop.name ?? rxcui,
      summary: prop.tty ? `Term type: ${prop.tty}` : null,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'RxNorm',
      contentType: 'drug_concept',
      authors: [],
      organization: 'US National Library of Medicine',
      publishedAt: null,
      updatedAt: null,
      geography: 'US',
      language: 'en',
      identifiers: { rxcui, ...(prop.tty ? { term_type: prop.tty } : {}) },
      subjects: [],
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
      throw new Error(`RxNorm search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/drugs.json?name=aspirin`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'drugs endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const rxnormAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
