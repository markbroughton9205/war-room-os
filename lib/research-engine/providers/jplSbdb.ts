import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'jpl_sbdb' as const
const BASE_URL = 'https://ssd-api.jpl.nasa.gov/sbdb.api'

type SbdbResponse = {
  object?: { fullname?: string; des?: string; spkid?: string; kind?: string; neo?: boolean; pha?: boolean; orbit_class?: { name?: string } }
  orbit?: { epoch?: string; last_obs?: string }
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const name = query.text.trim().slice(0, 100)
  if (!name) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `jpl_sbdb:${name}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('sstr', name)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SbdbResponse>(result.text)
  const obj = data?.object
  if (!obj || !obj.spkid) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${obj.spkid}`
  const documents = [makeDocument({
    id: `jpl_sbdb:${obj.spkid}`,
    provider: PROVIDER,
    providerRecordId: obj.spkid,
    title: obj.fullname ?? obj.des ?? obj.spkid,
    summary: obj.orbit_class?.name ? `Orbit class: ${obj.orbit_class.name}` : null,
    contentSnippet: [obj.neo ? 'Near-Earth Object' : null, obj.pha ? 'Potentially Hazardous Asteroid' : null].filter(Boolean).join(', ') || null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'JPL Small-Body Database',
    contentType: 'small_body_record',
    authors: [],
    organization: 'NASA/JPL',
    publishedAt: null,
    updatedAt: data?.orbit?.last_obs ?? null,
    geography: null,
    language: null,
    identifiers: { spkid: obj.spkid, ...(obj.des ? { designation: obj.des } : {}) },
    subjects: obj.orbit_class?.name ? [obj.orbit_class.name] : [],
    license: null,
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
      throw new Error(`JPL SBDB fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?sstr=Ceres`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'sbdb.api reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const jplSbdbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
