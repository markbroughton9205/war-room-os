import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ine_tempus3' as const
const BASE_URL = 'https://servicios.ine.es/wstempus/js/EN/DATOS_TABLA'
const TABLE_CODE_PATTERN = /^\d{4,7}$/
const DEFAULT_TABLE = '50913' // National CPI overall index

type DataPoint = { Fecha?: number; Anyo?: number; FK_Periodo?: number; Valor?: number }
type SeriesEntry = { COD?: string; Nombre?: string; Data?: DataPoint[] }

/** Query text is an INE table code (e.g. "50913"); defaults to the national CPI overall index if not numeric. */
function resolveTableCode(text: string): string {
  const trimmed = text.trim()
  return TABLE_CODE_PATTERN.test(trimmed) ? trimmed : DEFAULT_TABLE
}

async function fetchTable(query: ResearchQuery) {
  const started = Date.now()
  const tableCode = resolveTableCode(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `ine_tempus3:${tableCode}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${tableCode}?nult=${limit}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SeriesEntry[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'INE Tempus3 response was not a JSON array.' }
  }

  const canonicalUrl = `https://www.ine.es/jaxiT3/Tabla.htm?t=${tableCode}`
  // "data" is an array of series entries (one per breakdown/category), each
  // carrying its own Data[] points — real INE tables return dozens of
  // entries, so the overall output must be capped after flattening, not
  // per-entry (a per-entry-only cap let a single query balloon to
  // entries.length * limit records, confirmed live: 5200 for one table).
  const documents = data.flatMap(entry => {
    const points = entry.Data ?? []
    return points.slice(0, limit).map((point, index) => makeDocument({
      id: `ine_tempus3:${entry.COD ?? tableCode}:${point.Fecha ?? index}`,
      provider: PROVIDER,
      providerRecordId: `${entry.COD ?? tableCode}:${index}`,
      title: `${entry.Nombre ?? tableCode} — ${point.Anyo ?? ''}`,
      summary: point.Valor != null ? `Value: ${point.Valor}` : null,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'Instituto Nacional de Estadística (Spain)',
      contentType: 'economic_time_series_point',
      authors: [],
      organization: 'INE Spain',
      publishedAt: point.Anyo != null ? String(point.Anyo) : null,
      updatedAt: null,
      geography: 'ES',
      language: 'es',
      identifiers: { ine_table_code: tableCode },
      subjects: [],
      license: null,
      accessStatus: 'open',
    }))
  }).slice(0, limit)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchTable(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`INE Tempus3 fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${DEFAULT_TABLE}?nult=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'tabla endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ineTempus3Adapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
