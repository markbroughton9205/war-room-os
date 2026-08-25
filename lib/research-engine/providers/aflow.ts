import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'aflow' as const
// The classic AFLUX endpoint (aflowlib.duke.edu) is dead (confirmed 404
// during research) — this targets AFLOW's real, current OPTIMADE-standard
// replacement. Its /structures data endpoint was confirmed live to be
// returning HTTP 500 server-side on AFLOW's own backend at build time
// (including a bare no-filter request) — a genuine current upstream
// degradation, not a client-side defect; this adapter's request/parse logic
// is correct against the documented OPTIMADE contract and should recover
// automatically if/when AFLOW's backend is fixed.
const BASE_URL = 'https://aflow.org/API/optimade/structures'
const MAX_RESULTS = 20

type OptimadeStructure = { id?: string; attributes?: { chemical_formula_reduced?: string; elements?: string[]; nsites?: number } }
type OptimadeResponse = { data?: OptimadeStructure[] }

/** Escapes a caller's text for safe interpolation into an OPTIMADE filter string literal. */
function escapeOptimadeLiteral(text: string): string {
  return text.replace(/"/g, '\\"')
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const formula = query.text.trim().slice(0, 50)
  if (!formula) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `aflow:${formula}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('filter', `chemical_formula_reduced="${escapeOptimadeLiteral(formula)}"`)
  url.searchParams.set('page_limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OptimadeResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'AFLOW OPTIMADE response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(s => s.id)
    .map(s => {
      const id = s.id as string
      const canonicalUrl = `https://aflow.org/material.php?id=${id}`
      return makeDocument({
        id: `aflow:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: s.attributes?.chemical_formula_reduced ?? id,
        summary: typeof s.attributes?.nsites === 'number' ? `${s.attributes.nsites} sites` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'AFLOW',
        contentType: 'materials_science_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { aflow_id: id },
        subjects: s.attributes?.elements ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`AFLOW OPTIMADE search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, 'https://aflow.org/API/optimade/info', { timeoutMs: 10_000 })
    // Always reported degraded: /info alone doesn't prove /structures (the
    // endpoint this adapter actually queries) is servable — confirmed
    // 500ing server-side on AFLOW's own backend as of build time.
    return { provider: PROVIDER, state: 'degraded', checkedAt: nowIso(), detail: result.ok ? 'OPTIMADE /info reachable, but /structures is confirmed 500ing server-side as of build time' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const aflowAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
