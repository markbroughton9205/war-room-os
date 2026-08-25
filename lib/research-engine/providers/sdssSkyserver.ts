import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'sdss_skyserver' as const
const BASE_URL = 'https://skyserver.sdss.org/dr18/SkyServerWS/SearchTools/SqlSearch'
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/
const MAX_RESULTS = 25

type ResultSet = { TableName?: string; Rows?: Record<string, unknown>[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const match = COORD_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be "ra,dec" sky coordinates in degrees (e.g. "185.0,15.0").')
  const [, ra, dec] = match
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `sdss_skyserver:${ra}:${dec}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const sql = `SELECT TOP ${limit} objID,ra,dec,type,r,g FROM PhotoObj WHERE ra BETWEEN ${Number(ra) - 0.05} AND ${Number(ra) + 0.05} AND dec BETWEEN ${Number(dec) - 0.05} AND ${Number(dec) + 0.05}`
  const url = new URL(BASE_URL)
  url.searchParams.set('cmd', sql)
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 20_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ResultSet[]>(result.text)
  const rows = data?.[0]?.Rows
  if (!Array.isArray(rows)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SDSS SkyServer response did not contain a "Rows" array in the first result set.' }
  }

  const documents = rows
    .filter(row => row.objID != null)
    .map(row => {
      const objId = String(row.objID)
      const canonicalUrl = `https://skyserver.sdss.org/dr18/VisualTools/explore/summary?id=${objId}`
      return makeDocument({
        id: `sdss_skyserver:${objId}`,
        provider: PROVIDER,
        providerRecordId: objId,
        title: `SDSS object ${objId}`,
        summary: row.type != null ? `Type: ${row.type}` : null,
        contentSnippet: row.ra != null && row.dec != null ? `RA ${row.ra}, Dec ${row.dec}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'SDSS SkyServer',
        contentType: 'astronomical_object',
        authors: [],
        organization: 'Sloan Digital Sky Survey',
        publishedAt: null,
        updatedAt: null,
        geography: row.ra != null && row.dec != null ? `RA ${row.ra}, Dec ${row.dec}` : null,
        language: null,
        identifiers: { sdss_obj_id: objId },
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
      if (outcome.kind === 'http_error') throw new Error(`SDSS SkyServer search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = new URL(BASE_URL)
    url.searchParams.set('cmd', 'SELECT TOP 1 objID FROM PhotoObj')
    url.searchParams.set('format', 'json')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'SqlSearch endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const sdssSkyserverAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
