import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nasa_exoplanet_archive' as const
const BASE_URL = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync'
const MAX_RESULTS = 20
const COLUMNS = 'pl_name,hostname,discoverymethod,disc_year,pl_orbper,pl_rade'

type PlanetRow = { pl_name?: string; hostname?: string; discoverymethod?: string; disc_year?: number; pl_orbper?: number; pl_rade?: number }

/** Escapes a caller's text for safe interpolation into an ADQL string literal (single-quote doubling — no bind-parameter mechanism exists for TAP sync). */
function escapeAdqlLiteral(text: string): string {
  return text.replace(/'/g, "''")
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `nasa_exoplanet_archive:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // pscomppars (Planetary Systems Composite Parameters) has one curated
  // best-estimate row per planet — the "ps" table has one row per
  // publication/reference, which would produce many near-duplicates.
  const adql = `SELECT TOP ${limit} ${COLUMNS} FROM pscomppars WHERE pl_name LIKE '%${escapeAdqlLiteral(text)}%'`
  const url = new URL(BASE_URL)
  url.searchParams.set('query', adql)
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const rows = safeJsonParse<PlanetRow[]>(result.text)
  if (!Array.isArray(rows)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NASA Exoplanet Archive response was not a JSON array.' }
  }

  const documents = rows
    .filter(row => row.pl_name)
    .map(row => {
      const name = row.pl_name as string
      const canonicalUrl = `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(name)}`
      return makeDocument({
        id: `nasa_exoplanet_archive:${name}`,
        provider: PROVIDER,
        providerRecordId: name,
        title: name,
        summary: row.hostname ? `Host star: ${row.hostname}` : null,
        contentSnippet: row.discoverymethod ? `Discovered via ${row.discoverymethod}${row.disc_year ? ` (${row.disc_year})` : ''}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NASA Exoplanet Archive',
        contentType: 'exoplanet_record',
        authors: [],
        organization: 'NASA/Caltech IPAC',
        publishedAt: row.disc_year ? String(row.disc_year) : null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { pl_name: name, ...(row.hostname ? { hostname: row.hostname } : {}) },
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
      if (outcome.kind === 'http_error') throw new Error(`NASA Exoplanet Archive query failed with HTTP ${outcome.status}`)
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
    url.searchParams.set('query', `SELECT TOP 1 pl_name FROM pscomppars WHERE pl_name='Kepler-10 b'`)
    url.searchParams.set('format', 'json')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'TAP sync endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nasaExoplanetArchiveAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
