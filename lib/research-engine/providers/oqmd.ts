import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'oqmd' as const
const BASE_URL = 'https://oqmd.org/oqmdapi/formationenergy'
const MAX_RESULTS = 20

type OqmdEntry = { entry_id?: number; name?: string; spacegroup?: string; delta_e?: number; band_gap?: number; stability?: number }
type OqmdResponse = { data?: OqmdEntry[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const composition = query.text.trim().slice(0, 50)
  if (!composition) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `oqmd:${composition}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('composition', composition)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OqmdResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OQMD response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(entry => typeof entry.entry_id === 'number')
    .map(entry => {
      const id = String(entry.entry_id)
      const canonicalUrl = `https://oqmd.org/materials/entry/${id}`
      return makeDocument({
        id: `oqmd:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: entry.name ?? id,
        summary: entry.spacegroup ? `Space group: ${entry.spacegroup}` : null,
        contentSnippet: typeof entry.delta_e === 'number' ? `Formation energy: ${entry.delta_e} eV/atom` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OQMD (Open Quantum Materials Database)',
        contentType: 'materials_science_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { oqmd_entry_id: id },
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
      if (outcome.kind === 'http_error') throw new Error(`OQMD search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?composition=Fe2O3&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'formationenergy endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const oqmdAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
