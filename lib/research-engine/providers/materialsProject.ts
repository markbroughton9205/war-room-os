import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'materials_project' as const
const BASE_URL = 'https://api.materialsproject.org/materials/summary/'
const MAX_RESULTS = 20

type MpMaterial = { material_id?: string; formula_pretty?: string; symmetry?: { crystal_system?: string; space_group_symbol?: string }; energy_above_hull?: number; band_gap?: number; is_stable?: boolean }
type MpResponse = { data?: MpMaterial[] }

function apiKey(): string {
  return process.env.MATERIALS_PROJECT_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const formula = query.text.trim().slice(0, 50)
  if (!formula) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `materials_project:${formula}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('formula', formula)
  url.searchParams.set('_limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'X-API-KEY': apiKey() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<MpResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Materials Project response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(mat => mat.material_id)
    .map(mat => {
      const id = mat.material_id as string
      const canonicalUrl = `https://next-gen.materialsproject.org/materials/${id}`
      return makeDocument({
        id: `materials_project:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: mat.formula_pretty ?? id,
        summary: mat.symmetry?.crystal_system ? `Crystal system: ${mat.symmetry.crystal_system}` : null,
        contentSnippet: typeof mat.band_gap === 'number' ? `Band gap: ${mat.band_gap} eV` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Materials Project',
        contentType: 'materials_science_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { material_id: id, ...(typeof mat.is_stable === 'boolean' ? { is_stable: String(mat.is_stable) } : {}) },
        subjects: mat.symmetry?.space_group_symbol ? [mat.symmetry.space_group_symbol] : [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'MATERIALS_PROJECT_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Materials Project search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'MATERIALS_PROJECT_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?formula=Fe2O3&_limit=1`, { headers: { 'X-API-KEY': apiKey() }, timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'summary endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const materialsProjectAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
