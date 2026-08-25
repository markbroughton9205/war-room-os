import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'eurostat' as const
const BASE_URL = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data'
const MAX_DECODED_POINTS = 20
const DATASET_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,40}$/

/**
 * Eurostat's REST API is dataset-code-addressed, not free-text searchable
 * server-side (confirmed during research — a real API constraint, not an
 * integration gap). A small keyword lookup covers common queries; a caller
 * can also pass an exact dataset code (e.g. "DEMO_R_D3DENS") directly.
 */
const KEYWORD_TO_DATASET: Record<string, string> = {
  population: 'DEMO_R_D3DENS',
  'population density': 'DEMO_R_D3DENS',
  unemployment: 'UNE_RT_M',
  gdp: 'NAMQ_10_GDP',
  inflation: 'PRC_HICP_MANR',
}

type JsonStatDimension = { label?: string; category?: { index?: Record<string, number>; label?: Record<string, string> } }
type JsonStatDataset = {
  label?: string
  id?: string[]
  size?: number[]
  dimension?: Record<string, JsonStatDimension>
  value?: Record<string, number> | number[]
}

function resolveDatasetCode(text: string): string | null {
  const trimmed = text.trim()
  if (DATASET_CODE_PATTERN.test(trimmed.toUpperCase()) && trimmed.toUpperCase() === trimmed) return trimmed
  const lower = trimmed.toLowerCase()
  return KEYWORD_TO_DATASET[lower] ?? null
}

/** Decodes a bounded number of JSON-stat 2.0 flat-index value entries into (dimension-combo label, value) pairs. */
function decodeSample(dataset: JsonStatDataset, limit: number): { label: string; value: number }[] {
  const ids = dataset.id ?? []
  const sizes = dataset.size ?? []
  if (ids.length === 0 || sizes.length !== ids.length) return []

  // Row-major strides: the last dimension varies fastest per JSON-stat 2.0.
  const strides: number[] = new Array(ids.length)
  let acc = 1
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    strides[i] = acc
    acc *= sizes[i] || 1
  }

  const reverseIndexes = ids.map(dimId => {
    const index = dataset.dimension?.[dimId]?.category?.index ?? {}
    const reversed: Record<number, string> = {}
    for (const [code, pos] of Object.entries(index)) reversed[pos] = code
    return reversed
  })

  const valueEntries: [string, number][] = Array.isArray(dataset.value)
    ? dataset.value.map((v, i) => [String(i), v])
    : Object.entries(dataset.value ?? {})

  const samples: { label: string; value: number }[] = []
  for (const [flatKey, value] of valueEntries) {
    if (samples.length >= limit) break
    const flatIndex = Number(flatKey)
    if (!Number.isFinite(flatIndex) || typeof value !== 'number') continue
    let remainder = flatIndex
    const parts: string[] = []
    for (let dim = 0; dim < ids.length; dim += 1) {
      const pos = Math.floor(remainder / strides[dim])
      remainder %= strides[dim]
      const code = reverseIndexes[dim][pos]
      const label = code ? dataset.dimension?.[ids[dim]]?.category?.label?.[code] ?? code : `pos${pos}`
      parts.push(label)
    }
    samples.push({ label: parts.join(' / '), value })
  }
  return samples
}

async function fetchDataset(query: ResearchQuery) {
  const started = Date.now()
  const code = resolveDatasetCode(query.text)
  if (!code) {
    throw new Error(`Query must be a known keyword (${Object.keys(KEYWORD_TO_DATASET).join(', ')}) or an exact Eurostat dataset code — Eurostat has no free-text search API.`)
  }
  const cacheKey = `eurostat:dataset:${code}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/${encodeURIComponent(code)}?format=JSON&lang=EN`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<JsonStatDataset>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.id)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Eurostat response was not a valid JSON-stat 2.0 dataset object.' }
  }

  const samples = decodeSample(data, MAX_DECODED_POINTS)
  const canonicalUrl = `https://ec.europa.eu/eurostat/databrowser/view/${code}/default/table`
  const documents = samples.map((sample, i) => makeDocument({
    id: `eurostat:${code}:${i}`,
    provider: PROVIDER,
    providerRecordId: `${code}:${i}`,
    title: `${data.label ?? code} — ${sample.label}`,
    summary: `Value: ${sample.value}`,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Eurostat',
    contentType: 'statistical_data_point',
    authors: [],
    organization: 'Eurostat (European Commission)',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { eurostat_dataset_code: code },
    subjects: [],
    license: null,
    accessStatus: 'open',
  }))
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchDataset(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Eurostat dataset fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/DEMO_R_D3DENS?format=JSON&lang=EN`, { timeoutMs: 10_000, maxResponseBytes: 4 * 1024 * 1024 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'dataset endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const eurostatAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
