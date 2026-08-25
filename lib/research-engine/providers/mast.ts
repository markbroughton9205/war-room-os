import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'mast' as const
const BASE_URL = 'https://mast.stsci.edu/api/v0/invoke'
const MAX_RESULTS = 20
const DEFAULT_RADIUS_DEG = 0.1
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?$/

type MastObservation = { obs_id?: string; obs_collection?: string; instrument_name?: string; target_name?: string; s_ra?: number; s_dec?: number; t_min?: number; proposal_pi?: string; dataproduct_type?: string }
type MastResponse = { status?: string; data?: MastObservation[] }

async function invoke(request: Record<string, unknown>) {
  const body = new URLSearchParams({ request: JSON.stringify(request) })
  return safeProviderFetch(PROVIDER, BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 15_000 })
}

/** Resolves a plain-text object name to RA/Dec via MAST's name-resolver service. */
async function resolveName(name: string): Promise<{ ra: number; dec: number } | null> {
  const result = await invoke({ service: 'Mast.Name.Lookup', params: { input: name }, format: 'json' })
  if (!result.ok) return null
  const data = safeJsonParse<{ resolvedCoordinate?: { ra?: number; decl?: number }[] }>(result.text)
  const coord = data?.resolvedCoordinate?.[0]
  if (!coord || typeof coord.ra !== 'number' || typeof coord.decl !== 'number') return null
  return { ra: coord.ra, dec: coord.decl }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `mast:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const coordMatch = COORD_PATTERN.exec(text)
  let ra: number
  let dec: number
  let radius: number
  if (coordMatch) {
    ra = Number(coordMatch[1])
    dec = Number(coordMatch[2])
    radius = coordMatch[3] ? Number(coordMatch[3]) : DEFAULT_RADIUS_DEG
  } else {
    const resolved = await resolveName(text)
    if (!resolved) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
    ra = resolved.ra
    dec = resolved.dec
    radius = DEFAULT_RADIUS_DEG
  }

  const result = await invoke({ service: 'Mast.Caom.Cone', params: { ra, dec, radius }, format: 'json', pagesize: limit })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<MastResponse>(result.text)
  if (!data || data.status !== 'COMPLETE' || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'MAST cone-search response was not a completed result with a "data" array.' }
  }

  // MAST's documented `pagesize` param does not reliably bound the response
  // size (confirmed live: a 0.2°-radius cone search returned thousands of
  // rows despite pagesize=10) — sliced explicitly rather than trusting it.
  const canonicalUrl = 'https://mast.stsci.edu/portal/Mashup/Clients/Mast/Portal.html'
  const documents = data.data
    .filter(obs => obs.obs_id)
    .slice(0, limit)
    .map(obs => makeDocument({
      id: `mast:${obs.obs_id}`,
      provider: PROVIDER,
      providerRecordId: obs.obs_id as string,
      title: obs.target_name ?? (obs.obs_id as string),
      summary: obs.obs_collection && obs.instrument_name ? `${obs.obs_collection} / ${obs.instrument_name}` : null,
      contentSnippet: obs.dataproduct_type ? `Product type: ${obs.dataproduct_type}` : null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'MAST (Mikulski Archive for Space Telescopes)',
      contentType: 'space_telescope_observation',
      authors: obs.proposal_pi ? [obs.proposal_pi] : [],
      organization: obs.obs_collection ?? null,
      publishedAt: typeof obs.t_min === 'number' ? String(obs.t_min) : null,
      updatedAt: null,
      geography: typeof obs.s_ra === 'number' && typeof obs.s_dec === 'number' ? `RA ${obs.s_ra}°, Dec ${obs.s_dec}°` : null,
      language: null,
      identifiers: { mast_obs_id: obs.obs_id as string },
      subjects: [],
      license: null,
      accessStatus: 'open',
    }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`MAST search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await invoke({ service: 'Mast.Caom.Cone', params: { ra: 10.68, dec: 41.27, radius: 0.01 }, format: 'json', pagesize: 1 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'invoke endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const mastAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
