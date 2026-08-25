import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nomad_repository' as const
const BASE_URL = 'https://nomad-lab.eu/prod/v1/api/v1/entries'
const MAX_RESULTS = 25
const ELEMENT_PATTERN = /^[A-Za-z]{1,3}$/

type Material = { chemical_formula_hill?: string; elements?: string[]; structural_type?: string }
type Entry = { entry_id?: string; upload_id?: string; results?: { material?: Material }; upload_create_time?: string; origin?: string }
type EntriesResponse = { data?: Entry[]; pagination?: { total?: number } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const element = query.text.trim()
  if (!ELEMENT_PATTERN.test(element)) {
    throw new Error('Query must be a chemical element symbol (e.g. "Si", "Fe").')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `nomad_repository:${element}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const symbol = element.charAt(0).toUpperCase() + element.slice(1).toLowerCase()
  const url = new URL(BASE_URL)
  url.searchParams.set('results.material.elements', symbol)
  url.searchParams.set('page_size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 20_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<EntriesResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NOMAD response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(e => typeof e.entry_id === 'string')
    .map(e => {
      const id = e.entry_id as string
      const material = e.results?.material
      const canonicalUrl = `https://nomad-lab.eu/prod/v1/gui/search/entries/entry/id/${encodeURIComponent(id)}`
      return makeDocument({
        id: `nomad_repository:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: material?.chemical_formula_hill ?? id,
        summary: material?.structural_type ?? null,
        contentSnippet: material?.elements ? `Elements: ${material.elements.join(', ')}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NOMAD Repository',
        contentType: 'materials_science_entry',
        authors: e.origin ? [e.origin] : [],
        organization: 'NOMAD (FAIRmat/Max Planck)',
        publishedAt: e.upload_create_time ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { nomad_entry_id: id, ...(e.upload_id ? { nomad_upload_id: e.upload_id } : {}) },
        subjects: material?.elements ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`NOMAD search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?results.material.elements=Si&page_size=1`, { timeoutMs: 15_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'entries endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nomadRepositoryAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
