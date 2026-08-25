import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'gaia_archive' as const
const BASE_URL = 'https://gea.esac.esa.int/tap-server/tap/sync'
const SOURCE_ID_PATTERN = /^\d{10,20}$/

type Metadata = { name?: string }
type TapResponse = { metadata?: Metadata[]; data?: (string | number | null)[][] }

/** Query text is a Gaia DR3 source_id (confirmed via TAP-JSON column/data
 * array decode, same pattern as this codebase's simbad adapter). */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const sourceId = query.text.trim()
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error('Query must be a Gaia DR3 source_id (10-20 digit number).')
  }
  const cacheKey = `gaia_archive:${sourceId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const adql = `SELECT source_id,ra,dec,parallax,pmra,pmdec,phot_g_mean_mag FROM gaiadr3.gaia_source WHERE source_id=${sourceId}`
  const url = new URL(BASE_URL)
  url.searchParams.set('REQUEST', 'doQuery')
  url.searchParams.set('LANG', 'ADQL')
  url.searchParams.set('FORMAT', 'json')
  url.searchParams.set('QUERY', adql)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 20_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<TapResponse>(result.text)
  const columns = parsed?.metadata
  const rows = parsed?.data
  if (!columns || !rows) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Gaia Archive TAP response did not contain the expected metadata/data shape.' }
  }

  const colIndex = (name: string) => columns.findIndex(c => c.name === name)
  const raIdx = colIndex('ra')
  const decIdx = colIndex('dec')
  const magIdx = colIndex('phot_g_mean_mag')

  const canonicalUrl = `https://vizier.cds.unistra.fr/viz-bin/VizieR-5?-source=I/355&Source=${sourceId}`
  const documents = rows.map(row => {
    const ra = raIdx >= 0 ? row[raIdx] : null
    const dec = decIdx >= 0 ? row[decIdx] : null
    return makeDocument({
      id: `gaia_archive:${sourceId}`,
      provider: PROVIDER,
      providerRecordId: sourceId,
      title: `Gaia DR3 ${sourceId}`,
      summary: ra != null && dec != null ? `RA ${ra}, Dec ${dec}` : null,
      contentSnippet: magIdx >= 0 && row[magIdx] != null ? `G mag: ${row[magIdx]}` : null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'ESA Gaia Archive',
      contentType: 'stellar_astrometry',
      authors: [],
      organization: 'European Space Agency',
      publishedAt: null,
      updatedAt: null,
      geography: ra != null && dec != null ? `RA ${ra}, Dec ${dec}` : null,
      language: null,
      identifiers: { gaia_source_id: sourceId },
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
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Gaia Archive lookup failed with HTTP ${outcome.status}`)
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
    url.searchParams.set('REQUEST', 'doQuery')
    url.searchParams.set('LANG', 'ADQL')
    url.searchParams.set('FORMAT', 'json')
    url.searchParams.set('QUERY', 'SELECT TOP 1 source_id FROM gaiadr3.gaia_source')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'TAP sync endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const gaiaArchiveAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
