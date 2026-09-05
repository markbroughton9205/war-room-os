import 'server-only'

/**
 * Shared helper for the PxWebApi-family national-statistics providers (scbSweden.ts,
 * ssbNorway.ts, statfinFinland.ts — each a distinct, thin adapter over its own official host,
 * sharing this one query/decode implementation rather than each reimplementing it).
 * statisticsDenmark.ts uses a related-but-distinct API (its own POST /v1/data contract) and only
 * reuses `flattenJsonStat2` from this file, since Denmark's response payload is the same
 * JSON-stat2 dataset shape wrapped one level deeper under a `dataset` key.
 *
 * PxWebApi (https://www.scb.se/en/services/open-data-api/api-for-the-statistical-database/) is a
 * real, stable, publicly documented protocol used by multiple national statistics agencies
 * (Statistics Sweden, Statistics Finland, and others). Every provider built on it shares the same
 * two-step shape: GET a table's metadata (its variables, each variable's real value codes, and
 * whether it is a "time" or "eliminable" dimension), then POST a query built from that same real
 * metadata to get JSON-stat2 data back. This file implements that two-step flow and a generic
 * JSON-stat2 decoder once, live-verified against SCB (Sweden), SSB (Norway), and StatFin (Finland)
 * during this mission — see docs/earth-knowledge/registry-parsed.md's wave audit for evidence.
 *
 * These are real, documented aggregate-statistics protocols, not a keyword full-text search
 * engine — a caller must name a specific table (there is no cross-table free-text search; this
 * mission's own live investigation confirmed no such capability exists on any of these hosts,
 * matching the pre-existing finding already recorded for SCB/SSB/StatBank Denmark/StatFin/OpenSTAT
 * in the Earth Knowledge registry). Each per-country adapter accepts an optional `table <path>`
 * override in the query text and falls back to one fixed, documented default table otherwise —
 * the same "fixed, documented default" convention already used by usgs_earthquake_feed and
 * usgs_water's required site-number query.
 */
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'

export type PxWebVariable = {
  code: string
  text: string
  values: string[]
  valueTexts: string[]
  elimination?: boolean
  time?: boolean
}

export type PxWebTableMetadata = {
  title: string
  variables: PxWebVariable[]
}

export type PxWebQuerySelector = {
  code: string
  selection: { filter: 'item' | 'top' | 'all'; values?: string[] }
}

/** A JSON-stat2 "dataset" object — https://json-stat.org/format/ — as returned directly by the
 * classic PxWebApi hosts (SCB/SSB/StatFin), or found at `.dataset` on Statistics Denmark's API.
 * `id`/`size` are typed optional: the classic PxWebApi hosts always include them (verified live),
 * but Statistics Denmark's API omits both — flattenJsonStat2 derives them from `dimension` and
 * each dimension's own category count when absent, per the JSON-stat2 spec's own note that both
 * are reconstructable from dimension order and cardinality. */
export type JsonStat2Dataset = {
  id?: string[]
  size?: number[]
  dimension: Record<string, { label: string; category: { index?: Record<string, number> | string[]; label: Record<string, string> } }>
  value: (number | null)[]
}

export type PxWebFlatCell = {
  /** dimension code -> real category label, e.g. { Region: "Sweden", Tid: "2023" } */
  labels: Record<string, string>
  value: number | null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export async function fetchPxWebTableMetadata(provider: ResearchProviderId, tableUrl: string, timeoutMs = 12_000): Promise<PxWebTableMetadata | null> {
  const result = await safeProviderFetch(provider, tableUrl, { timeoutMs, headers: { Accept: 'application/json' } })
  if (!result.ok) return null
  const data = safeJsonParse<{ title?: string; variables?: PxWebVariable[] }>(result.text)
  if (!data || !Array.isArray(data.variables)) return null
  return { title: data.title ?? '', variables: data.variables }
}

/**
 * Builds a deterministic default query from real table metadata: the most recent `periods`
 * values for the one variable flagged `time: true` (PxWebApi's own "top N" query feature — a
 * real, documented mechanism, not a guess), and the FIRST real value code for every other
 * variable. Selecting index 0 rather than wildcarding every eliminable dimension is a deliberate,
 * live-verified choice — wildcarding every eliminable dimension at once was proven during this
 * mission to overflow SCB's own query-size limit on tables with several large-cardinality
 * dimensions (a real HTTP 400, not a guess), while selecting a single first value never can.
 * National statistics agencies conventionally list their whole-country/whole-population
 * aggregate code first (confirmed for both SCB's Region="00" and SSB's Region="0" during this
 * mission's live verification), so this frequently — though not guaranteedly — resolves to a
 * genuine national aggregate; when it does not, the result is still real, correctly-labeled data
 * for whichever real category sorts first, never a fabricated total.
 */
export function buildDefaultPxWebQuery(metadata: PxWebTableMetadata, periods = 3): PxWebQuerySelector[] {
  return metadata.variables.map(variable => {
    if (variable.time) return { code: variable.code, selection: { filter: 'top', values: [String(periods)] } }
    return { code: variable.code, selection: { filter: 'item', values: [variable.values[0]] } }
  })
}

export async function queryPxWebTable(provider: ResearchProviderId, tableUrl: string, query: PxWebQuerySelector[], timeoutMs = 15_000): Promise<{ ok: true; dataset: JsonStat2Dataset } | { ok: false; status: number | null; message: string }> {
  const result = await safeProviderFetch(provider, tableUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, response: { format: 'json-stat2' } }),
    timeoutMs,
  })
  if (!result.ok) return { ok: false, status: result.status, message: `PxWeb query failed with HTTP ${result.status}` }
  const raw = safeJsonParse<Record<string, unknown>>(result.text)
  if (!raw || typeof raw !== 'object') return { ok: false, status: null, message: 'PxWeb response was not valid JSON.' }
  const dataset = (raw.dataset && typeof raw.dataset === 'object' ? raw.dataset : raw) as JsonStat2Dataset
  if (!Array.isArray(dataset.id) || !Array.isArray(dataset.size) || !Array.isArray(dataset.value) || typeof dataset.dimension !== 'object') {
    return { ok: false, status: null, message: 'PxWeb response was not a recognizable JSON-stat2 dataset.' }
  }
  return { ok: true, dataset }
}

/** Every category code for one JSON-stat2 dimension, in the same order its `value` array indexes
 * against. JSON-stat2 allows `category.index` to be omitted entirely for a single-category
 * dimension (the sole key of `category.label` is then the only code), an array of codes in order,
 * or an object mapping code -> position — all three forms occur across the real responses this
 * mission observed live (SCB/SSB/StatFin/Denmark), so all three are handled explicitly rather
 * than assuming one shape. */
function dimensionCodesInIndexOrder(dimension: JsonStat2Dataset['dimension'][string]): string[] {
  const index = dimension.category.index
  if (index === undefined) return Object.keys(dimension.category.label ?? {})
  if (Array.isArray(index)) return index
  const codes: string[] = []
  for (const [code, position] of Object.entries(index)) codes[position] = code
  return codes
}

/**
 * Decodes a JSON-stat2 dataset's flat `value` array into one real, labeled cell per entry — the
 * standard JSON-stat2 row-major convention (https://json-stat.org/format/#value), the last
 * dimension in `id` varying fastest. Never sums, infers, or drops a value: a `null` in the source
 * array is preserved as `null`, exactly like ResearchTimeSeriesPoint's own missing-value
 * convention elsewhere in this codebase.
 */
export function flattenJsonStat2(dataset: JsonStat2Dataset): PxWebFlatCell[] {
  const { value, dimension } = dataset
  const id = dataset.id ?? Object.keys(dimension)
  const codesByDimension = id.map(dimId => dimensionCodesInIndexOrder(dimension[dimId]))
  const size = dataset.size ?? codesByDimension.map(codes => codes.length)
  const labelsByDimension = id.map(dimId => dimension[dimId].category.label ?? {})

  const cells: PxWebFlatCell[] = []
  for (let flatIndex = 0; flatIndex < value.length; flatIndex++) {
    let remainder = flatIndex
    const positions = new Array<number>(size.length)
    for (let dim = size.length - 1; dim >= 0; dim--) {
      positions[dim] = remainder % size[dim]
      remainder = Math.floor(remainder / size[dim])
    }
    const labels: Record<string, string> = {}
    for (let dim = 0; dim < id.length; dim++) {
      const code = codesByDimension[dim][positions[dim]]
      labels[id[dim]] = labelsByDimension[dim][code] ?? code
    }
    const rawValue = value[flatIndex]
    cells.push({ labels, value: isFiniteNumber(rawValue) ? rawValue : null })
  }
  return cells
}

/** Scans every dimension's JSON-stat2 `category.unit` (a real, optional per-code unit-of-measure
 * object the spec allows, e.g. SCB's ContentsCode dimension carries `{"base":"number", ...}`) and
 * returns the first `base` string found, or null when no dimension carries one — never guessed. */
export function extractPxWebUnit(dataset: JsonStat2Dataset): string | null {
  for (const dimId of dataset.id ?? Object.keys(dataset.dimension)) {
    const unit = (dataset.dimension[dimId] as { category: { unit?: Record<string, { base?: string }> } }).category.unit
    if (!unit) continue
    const first = Object.values(unit)[0]
    if (first?.base) return first.base
  }
  return null
}

/** Parses an optional `table <path>` override out of free-text query text — the same
 * required-explicit-identifier convention usgs_water's `site <digits>` query text already
 * established for a source with no cross-record free-text search. Returns null when absent, so
 * the caller falls back to its own fixed documented default table. */
export function parseTableOverride(text: string): string | null {
  const match = /\btable\s+([A-Za-z0-9_./-]+)/i.exec(text)
  return match ? match[1] : null
}
