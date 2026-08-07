import 'server-only'

import type { ResearchGeoFeature, ResearchHealthStatus, ResearchQuery, ResearchTimeSeries, ResearchTimeSeriesPoint } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'usgs_water' as const

// Only the `daily` collection is authorized for this implementation — no
// arbitrary caller-supplied collection name is ever accepted.
const COLLECTION = 'daily'

// Bounds the number of daily-value points requested from the API and,
// defensively, the count actually normalized even if an upstream response
// were to return more rows than requested.
const MAX_POINTS = 100
const MAX_QUERY_TEXT_LENGTH = 300

type WaterFeatureProperties = {
  monitoring_location_id?: string | null
  parameter_code?: string | null
  statistic_id?: string | null
  timeseries_id?: string | null
  time?: string | null
  value?: number | null
  unit_of_measure?: string | null
  qualifier?: string[] | string | null
  approvals_status?: string | string[] | null
  last_modified?: string | null
}
type WaterFeature = {
  id?: string
  properties?: WaterFeatureProperties
  geometry?: { type: string; coordinates: [number, number] } | null
}
type WaterFeatureCollection = { type?: string; features?: WaterFeature[] }

class UsgsWaterQueryError extends Error {}

class UsgsWaterProviderError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('USGS_WATER_API_BASE_URL', descriptor)) || 'https://api.waterdata.usgs.gov'
}

function apiKeyHeaders(): Record<string, string> {
  const key = process.env.USGS_WATER_API_KEY?.trim()
  return key ? { 'X-Api-Key': key } : {}
}

/** Validates and normalizes an RFC3339 date/date-time string; returns null (never throws) for anything else. */
function sanitizeDate(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(trimmed) ? trimmed : null
}

/**
 * Query convention: the request text must explicitly carry a monitoring-
 * location site number (`site <8-15 digits>` or `USGS-<8-15 digits>`), with
 * optional `parameter <code>` / `statistic <id>` filters. This is a bounded,
 * explicit convention — arbitrary free text never becomes a location id.
 */
function parseWaterQuery(text: string): { monitoringLocationId: string; parameterCode: string | null; statisticId: string | null } {
  const bounded = text.slice(0, MAX_QUERY_TEXT_LENGTH)
  const siteMatch = /\b(?:site[:\s]+|usgs-)(\d{8,15})\b/i.exec(bounded)
  if (!siteMatch) {
    throw new UsgsWaterQueryError('A valid USGS monitoring-location site number is required, e.g. "site 01646500".')
  }
  const parameterMatch = /\bparameter[:\s]+(\d{1,6})\b/i.exec(bounded)
  const statisticMatch = /\bstatistic[:\s]+(\d{1,6})\b/i.exec(bounded)
  return {
    monitoringLocationId: `USGS-${siteMatch[1]}`,
    parameterCode: parameterMatch ? parameterMatch[1] : null,
    statisticId: statisticMatch ? statisticMatch[1] : null,
  }
}

function approvalsText(value: string | string[] | null | undefined): string | null {
  if (!value) return null
  return Array.isArray(value) ? value.join(', ') : value
}

function qualifierText(value: string[] | string | null | undefined): string | null {
  if (!value) return null
  return Array.isArray(value) ? value.join(', ') : value
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** GeoJSON [lon, lat] — longitude/latitude must be finite and in-range; malformed geometry is ignored, never crashes the route. */
function isValidWaterCoordinates(coordinates: unknown): coordinates is [number, number] {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false
  const [lon, lat] = coordinates
  return isFiniteNumber(lon) && lon >= -180 && lon <= 180 && isFiniteNumber(lat) && lat >= -90 && lat <= 90
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const { monitoringLocationId, parameterCode, statisticId } = parseWaterQuery(query.text)

  const starttime = sanitizeDate(query.dateFrom) ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const endtime = sanitizeDate(query.dateTo) ?? new Date().toISOString().slice(0, 10)
  const limit = Math.max(1, Math.min(query.maxResults ?? 50, MAX_POINTS))

  const cacheKey = `usgs_water:${monitoringLocationId}:${parameterCode ?? '-'}:${statisticId ?? '-'}:${starttime}:${endtime}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/collections/${COLLECTION}/items`)
  url.searchParams.set('f', 'json')
  url.searchParams.set('monitoring_location_id', monitoringLocationId)
  url.searchParams.set('datetime', `${starttime}/${endtime}`)
  url.searchParams.set('limit', String(limit))
  if (parameterCode) url.searchParams.set('parameter_code', parameterCode)
  if (statisticId) url.searchParams.set('statistic_id', statisticId)
  // offset is intentionally never accepted from the caller — every request
  // starts at 0, and next-links from the response are never auto-followed.

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: apiKeyHeaders(), timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<WaterFeatureCollection>(result.text)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'USGS Water response was not a valid JSON object.' }
  }
  // `features` must be an explicit array — missing, null, or any non-array
  // shape is a malformed upstream response, never a fabricated empty
  // success. Only an explicit `features: []` is an honest empty result.
  if (!Array.isArray(data.features)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'USGS Water response "features" field was missing or not an array.' }
  }

  const features = data.features.slice(0, MAX_POINTS)
  if (features.length === 0) {
    const response = okResponse(PROVIDER, { documents: [], timeSeries: [], geoFeatures: [], durationMs: Date.now() - started })
    return { ok: true as const, response }
  }

  const points: ResearchTimeSeriesPoint[] = features.map(feature => ({
    date: feature.properties?.time ?? '',
    // A missing/null value is preserved as null, never coerced to 0; 0 is a real reading.
    value: typeof feature.properties?.value === 'number' ? feature.properties.value : null,
    note: [qualifierText(feature.properties?.qualifier), approvalsText(feature.properties?.approvals_status)].filter(Boolean).join('; ') || null,
  }))

  const geoFeatures: ResearchGeoFeature[] = features
    .filter(feature => feature.geometry && isValidWaterCoordinates(feature.geometry.coordinates))
    .map(feature => ({
      id: feature.id ?? monitoringLocationId,
      geometryType: feature.geometry!.type,
      coordinates: feature.geometry!.coordinates,
      properties: (feature.properties ?? {}) as unknown as Record<string, unknown>,
    }))
    // One monitoring location has one fixed position; dedupe repeated identical points defensively.
    .filter((feature, index, all) => all.findIndex(f => f.id === feature.id) === index)

  const warnings: string[] = []
  if (features.some(feature => (approvalsText(feature.properties?.approvals_status) ?? '').toLowerCase().includes('provisional'))) {
    warnings.push('One or more observations are marked provisional (approvals_status) and may be revised by USGS.')
  }
  if (features.some(feature => (qualifierText(feature.properties?.qualifier) ?? '').toLowerCase().match(/provisional|estimated/))) {
    warnings.push('One or more observations carry a provisional/estimated qualifier.')
  }
  if (points.some(point => point.value === null)) {
    warnings.push('One or more observations have a null/missing value, preserved as null (not zero).')
  }

  const parameterCodeResolved = parameterCode ?? features[0].properties?.parameter_code ?? null
  const statisticIdResolved = statisticId ?? features[0].properties?.statistic_id ?? null
  const siteNumber = monitoringLocationId.replace(/^USGS-/, '')
  const seriesId = `${monitoringLocationId}:${parameterCodeResolved ?? 'all'}:${statisticIdResolved ?? 'all'}`

  const timeSeries: ResearchTimeSeries[] = [{
    seriesId,
    title: `USGS Water — site ${siteNumber}${parameterCodeResolved ? ` param ${parameterCodeResolved}` : ''}`,
    unit: features[0].properties?.unit_of_measure ?? null,
    frequency: 'daily',
    points,
  }]

  const documents = [makeDocument({
    id: `usgs_water:${seriesId}`,
    provider: PROVIDER,
    providerRecordId: seriesId,
    title: `USGS Daily Water Values — site ${siteNumber}${parameterCodeResolved ? ` (parameter ${parameterCodeResolved})` : ''}`,
    summary: `USGS Water Data daily values for monitoring location ${monitoringLocationId}, ${starttime} to ${endtime}.`,
    contentSnippet: null,
    canonicalUrl: `https://waterdata.usgs.gov/monitoring-location/${siteNumber}/`,
    sourceUrl: `https://waterdata.usgs.gov/monitoring-location/${siteNumber}/`,
    sourceName: 'USGS Water Data',
    contentType: 'hydrology_time_series',
    authors: [],
    organization: 'USGS',
    publishedAt: null,
    updatedAt: features[0].properties?.last_modified ?? null,
    geography: siteNumber,
    language: 'en',
    identifiers: {
      usgs_monitoring_location_id: monitoringLocationId,
      ...(parameterCodeResolved ? { usgs_parameter_code: parameterCodeResolved } : {}),
      ...(statisticIdResolved ? { usgs_statistic_id: statisticIdResolved } : {}),
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
    warnings,
  })]

  const response = okResponse(PROVIDER, { documents, timeSeries, geoFeatures, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new UsgsWaterProviderError(`USGS Water search failed with HTTP ${outcome.status}`, 'upstream_error')
      throw new UsgsWaterProviderError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof UsgsWaterQueryError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: 'unknown', message: error.message, httpStatus: null }, 0)
    }
    if (error instanceof UsgsWaterProviderError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    // USGS-01646500 (Potomac River at Washington, DC) is a stable, well-known documented example site used only to ping the endpoint.
    const url = `${baseUrl()}/collections/${COLLECTION}/items?f=json&monitoring_location_id=USGS-01646500&limit=1`
    const result = await safeProviderFetch(PROVIDER, url, { headers: apiKeyHeaders(), timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'daily collection items endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usgsWaterAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
