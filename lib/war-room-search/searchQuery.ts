import { GEOGRAPHIC_REGIONS, type GeographicRegion } from '@/lib/council/scout-swarm/types'
import type { SearchDateRange, SearchRegionFilter, SearchRequest, SearchRequestOptions, SearchSort, SearchSourceTypeFilter } from './types'

export const DEFAULT_SEARCH_LIMIT = 12
export const MAX_SEARCH_LIMIT = 20
export const MIN_SEARCH_LIMIT = 1
export const MAX_SEARCH_QUERY_CHARS = 480
export const DEFAULT_SEARCH_TIMEOUT_MS = 25_000
export const MIN_SEARCH_TIMEOUT_MS = 4_000
export const MAX_SEARCH_TIMEOUT_MS = 45_000

const SOURCE_TYPES: SearchSourceTypeFilter[] = ['web', 'rss', 'government', 'academic', 'regulatory', 'corporate']

export type NormalizedSearchRequest = {
  query: string
  limit: number
  region: GeographicRegion | undefined
  regionFilter: SearchRegionFilter
  language: string | null
  dateRange: SearchDateRange | null
  sourceTypes: SearchSourceTypeFilter[] | null
  primaryOnly: boolean
  sort: SearchSort
  safeSearch: boolean
  timeoutMs: number
}

export function clampSearchLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_LIMIT
  return Math.max(MIN_SEARCH_LIMIT, Math.min(MAX_SEARCH_LIMIT, Math.floor(n)))
}

export function clampSearchTimeoutMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_TIMEOUT_MS
  return Math.max(MIN_SEARCH_TIMEOUT_MS, Math.min(MAX_SEARCH_TIMEOUT_MS, Math.floor(n)))
}

export function normalizeSearchQuery(raw: string): string {
  return raw.replace(/https?:\/\/[^\s]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_QUERY_CHARS)
}

export function parseSearchRegion(value: unknown): SearchRegionFilter {
  if (typeof value !== 'string') return 'ALL'
  const upper = value.trim().toUpperCase()
  if (upper === 'ALL' || upper === '') return 'ALL'
  return GEOGRAPHIC_REGIONS.includes(upper as GeographicRegion) ? (upper as GeographicRegion) : 'ALL'
}

export function geographicRegionFromFilter(filter: SearchRegionFilter): GeographicRegion | undefined {
  return filter === 'ALL' ? undefined : filter
}

function parseSort(value: unknown): SearchSort {
  return value === 'NEWEST' ? 'NEWEST' : 'RELEVANCE'
}

function parseSourceTypes(value: unknown): SearchSourceTypeFilter[] | null {
  if (!Array.isArray(value)) return null
  const next = value.filter((item): item is SearchSourceTypeFilter => typeof item === 'string' && SOURCE_TYPES.includes(item as SearchSourceTypeFilter))
  return next.length ? next : null
}

function parseDateRange(value: unknown): SearchDateRange | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  const from = typeof rec.from === 'string' && rec.from.trim() ? rec.from.trim() : null
  const to = typeof rec.to === 'string' && rec.to.trim() ? rec.to.trim() : null
  if (!from && !to) return null
  return { from, to }
}

export function normalizeSearchRequest(input: SearchRequest): NormalizedSearchRequest {
  const options: SearchRequestOptions = input.options ?? {}
  const regionFilter = parseSearchRegion(options.region)
  return {
    query: normalizeSearchQuery(input.query),
    limit: clampSearchLimit(options.limit),
    region: geographicRegionFromFilter(regionFilter),
    regionFilter,
    language: typeof options.language === 'string' && options.language.trim() ? options.language.trim().slice(0, 16) : null,
    dateRange: parseDateRange(options.dateRange),
    sourceTypes: parseSourceTypes(options.sourceTypes),
    primaryOnly: options.primaryOnly === true,
    sort: parseSort(options.sort),
    safeSearch: options.safeSearch !== false,
    timeoutMs: clampSearchTimeoutMs(options.timeoutMs),
  }
}

export function isSearchRequestEmpty(query: string): boolean {
  return !normalizeSearchQuery(query)
}
