import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'simbad' as const
const BASE_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync'
const MAX_RESULTS = 20

// IVOA-standard TAP-JSON: columns described in `metadata`, rows as
// positional arrays in `data` — NOT an array of named objects (a genuinely
// different shape from nasa_exoplanet_archive's plain-object-array response,
// despite both being "TAP").
type TapMetadataColumn = { name?: string }
type TapResponse = { metadata?: TapMetadataColumn[]; data?: unknown[][] }

function escapeAdqlLiteral(text: string): string {
  return text.replace(/'/g, "''")
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `simbad:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const adql = `SELECT TOP ${limit} main_id,ra,dec,otype FROM basic WHERE main_id LIKE '%${escapeAdqlLiteral(text)}%'`
  const url = new URL(BASE_URL)
  url.searchParams.set('request', 'doQuery')
  url.searchParams.set('lang', 'adql')
  url.searchParams.set('format', 'json')
  url.searchParams.set('query', adql)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<TapResponse>(result.text)
  if (!parsed || !Array.isArray(parsed.metadata) || !Array.isArray(parsed.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SIMBAD TAP response did not contain the expected metadata/data columns.' }
  }

  const columnIndex: Record<string, number> = {}
  parsed.metadata.forEach((col, i) => { if (col.name) columnIndex[col.name] = i })
  const idIdx = columnIndex.main_id
  const raIdx = columnIndex.ra
  const decIdx = columnIndex.dec
  const otypeIdx = columnIndex.otype
  if (idIdx === undefined) {
    return { ok: false as const, kind: 'malformed' as const, message: 'SIMBAD TAP response metadata did not include a "main_id" column.' }
  }

  const documents = parsed.data
    .filter(row => typeof row[idIdx] === 'string')
    .map(row => {
      // SIMBAD's catalog IDs carry internal padding spaces (e.g. "M  31",
      // fixed-width convention), not just leading/trailing whitespace —
      // collapsed to single spaces (then trimmed) for display/URL use.
      const mainId = (row[idIdx] as string).replace(/\s+/g, ' ').trim()
      const canonicalUrl = `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(mainId)}`
      const ra = raIdx !== undefined ? row[raIdx] : null
      const dec = decIdx !== undefined ? row[decIdx] : null
      return makeDocument({
        id: `simbad:${mainId}`,
        provider: PROVIDER,
        providerRecordId: mainId,
        title: mainId,
        summary: typeof ra === 'number' && typeof dec === 'number' ? `RA ${ra}°, Dec ${dec}° (ICRS J2000)` : null,
        contentSnippet: otypeIdx !== undefined && typeof row[otypeIdx] === 'string' ? `Object type: ${row[otypeIdx]}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'SIMBAD (CDS)',
        contentType: 'astronomical_object',
        authors: [],
        organization: 'Centre de Données astronomiques de Strasbourg',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { simbad_main_id: mainId },
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
      if (outcome.kind === 'http_error') throw new Error(`SIMBAD TAP query failed with HTTP ${outcome.status}`)
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
    url.searchParams.set('request', 'doQuery')
    url.searchParams.set('lang', 'adql')
    url.searchParams.set('format', 'json')
    url.searchParams.set('query', "SELECT TOP 1 main_id FROM basic WHERE main_id='M 31'")
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'TAP sync endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const simbadAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
