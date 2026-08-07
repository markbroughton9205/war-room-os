import 'server-only'

import type { ResearchDocument, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { decodeXmlEntities } from '@/lib/research-engine/security/xmlLite'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'usgs_sciencebase' as const

const MAX_QUERY_TEXT_LENGTH = 200
const MAX_SEARCH_RESULTS = 25
// ScienceBase item ids are 24-character hex ObjectIds. Only an exact,
// whole-string match against this pattern is ever treated as an id lookup —
// arbitrary free text never becomes a getById call.
const ITEM_ID_PATTERN = /^[0-9a-f]{24}$/i

type SbTag = { type?: string; name?: string }
type SbItem = {
  id?: string
  title?: string
  summary?: string
  body?: string
  tags?: SbTag[]
  ancestors?: string[]
  parentId?: string
  provenance?: { dateCreated?: string; lastUpdated?: string }
  link?: { url?: string }
}
type SbSearchResponse = { items?: SbItem[] }

class UsgsScienceBaseError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('USGS_SCIENCEBASE_API_BASE_URL', descriptor)) || 'https://www.sciencebase.gov/catalog'
}

function isValidItemId(text: string): boolean {
  return ITEM_ID_PATTERN.test(text.trim())
}

/** Strips markup and decodes entities from provider-supplied rich text; the result is still treated as untrusted display data, never executed. */
function stripHtmlToText(input: string | null | undefined): string | null {
  if (!input) return null
  const cleaned = decodeXmlEntities(input).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || null
}

function normalizeItem(item: SbItem): ResearchDocument {
  const id = item.id ?? null
  const title = item.title?.trim() || 'Untitled ScienceBase item'
  const summary = stripHtmlToText(item.summary ?? item.body ?? null)
  const canonicalUrl = item.link?.url ?? (id ? `https://www.sciencebase.gov/catalog/item/${id}` : null)
  const parentId = item.parentId ?? (item.ancestors && item.ancestors.length > 0 ? item.ancestors[item.ancestors.length - 1] : null)
  const tags = (item.tags ?? []).map(tag => tag.name).filter((name): name is string => Boolean(name)).slice(0, 20)

  return makeDocument({
    id: `usgs_sciencebase:${id ?? title}`,
    provider: PROVIDER,
    providerRecordId: id,
    title,
    summary,
    contentSnippet: summary,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'USGS ScienceBase',
    contentType: 'catalog_item',
    authors: [],
    organization: 'USGS',
    publishedAt: item.provenance?.dateCreated ?? null,
    updatedAt: item.provenance?.lastUpdated ?? null,
    geography: null,
    language: 'en',
    identifiers: {
      ...(id ? { sciencebase_item_id: id } : {}),
      ...(parentId ? { sciencebase_parent_id: parentId } : {}),
    },
    subjects: tags,
    license: null,
    accessStatus: 'open',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, MAX_QUERY_TEXT_LENGTH)
  const count = Math.max(1, Math.min(query.maxResults ?? 10, MAX_SEARCH_RESULTS))
  const cacheKey = `usgs_sciencebase:search:${text}:${count}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/items/`)
  url.searchParams.set('q', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('max', String(count))
  // offset is intentionally fixed at the API's own default (0); no caller-supplied offset or next-link auto-follow exists.

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, status: result.status }

  const data = safeJsonParse<SbSearchResponse>(result.text)
  if (data === null || typeof data !== 'object') {
    return { ok: false as const, malformed: true as const }
  }
  // No independently verifiable official contract in this repo shows that a
  // completely missing `items` field is a valid empty search response, so
  // this fails closed: `items` must be an explicit array. Missing, null, or
  // any non-array shape is a malformed upstream response, never a
  // fabricated empty success. Only an explicit `items: []` is honest.
  if (!Array.isArray(data.items)) {
    return { ok: false as const, malformed: true as const }
  }
  const items = data.items.slice(0, count)
  const documents = items.map(normalizeItem)

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function getById(id: string) {
  const started = Date.now()
  const cacheKey = `usgs_sciencebase:item:${id.toLowerCase()}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/item/${encodeURIComponent(id)}`)
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, status: result.status }

  const item = safeJsonParse<SbItem>(result.text)
  if (item === null || !item.id) {
    return { ok: false as const, malformed: true as const }
  }

  const response = okResponse(PROVIDER, { documents: [normalizeItem(item)], durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const trimmed = query.text.trim()
      if (isValidItemId(trimmed)) {
        const outcome = await getById(trimmed)
        if (!outcome.ok) {
          throw new UsgsScienceBaseError(
            outcome.malformed ? 'USGS ScienceBase item response could not be parsed.' : `USGS ScienceBase item lookup failed with HTTP ${outcome.status}`,
            outcome.malformed ? 'parse_error' : 'upstream_error',
          )
        }
        return outcome.response
      }
      const outcome = await search(query)
      if (!outcome.ok) {
        throw new UsgsScienceBaseError(
          outcome.malformed ? 'USGS ScienceBase search response could not be parsed.' : `USGS ScienceBase search failed with HTTP ${outcome.status}`,
          outcome.malformed ? 'parse_error' : 'upstream_error',
        )
      }
      return outcome.response
    })
  } catch (error) {
    if (error instanceof UsgsScienceBaseError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/items/?q=water&format=json&max=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'items search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const usgsScienceBaseAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
