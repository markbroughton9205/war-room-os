import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'semantic_scholar' as const
const BASE_URL = 'https://api.semanticscholar.org/graph/v1'
const TRUSTED_PAPER_URL_HOSTNAME = 'www.semanticscholar.org'

const MAX_QUERY_TEXT_LENGTH = 300
const MAX_RESULTS = 25
// Narrow, fixed field list: scholarly metadata only. Deliberately excludes
// `citations`/`references` (no recursive citation/reference expansion) and
// any PDF/openAccessPdf field (no PDF retrieval), per the Semantic Scholar
// provider-specific limits.
const FIELDS = 'paperId,title,abstract,year,authors,externalIds,url,venue,citationCount'

type SsAuthor = { authorId?: string | null; name?: string | null }
type SsExternalIds = { DOI?: string; ArXiv?: string; PubMed?: string; PubMedCentral?: string }
type SsPaper = {
  paperId?: string
  title?: string
  abstract?: string | null
  year?: number | null
  authors?: SsAuthor[] | null
  externalIds?: SsExternalIds | null
  url?: string | null
  venue?: string | null
  citationCount?: number | null
}
type SsSearchResponse = { total?: number; offset?: number; next?: number; data?: SsPaper[] }

class SemanticScholarError extends Error {
  category: 'upstream_error' | 'parse_error'
  constructor(message: string, category: 'upstream_error' | 'parse_error') {
    super(message)
    this.category = category
  }
}

function authHeaders(): Record<string, string> {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim()
  return key ? { 'x-api-key': key } : {}
}

/** Malformed author entries (non-array `authors`, non-object entries, non-string `name`) are dropped rather than crashing normalization. */
function normalizeAuthors(authors: unknown): string[] {
  if (!Array.isArray(authors)) return []
  return authors
    .map(author => (author && typeof author === 'object' && !Array.isArray(author) ? (author as SsAuthor).name : null))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map(name => name.trim())
    .slice(0, 20)
}

/** A non-object (or array) `externalIds` — e.g. a string — is treated as absent rather than crashing on property access. */
function resolveDoi(externalIds: unknown): string | null {
  if (!externalIds || typeof externalIds !== 'object' || Array.isArray(externalIds)) return null
  const doi = (externalIds as SsExternalIds).DOI
  return typeof doi === 'string' && doi.trim() ? doi.trim() : null
}

/**
 * Only a valid HTTPS URL on the accepted Semantic Scholar public origin is
 * ever used as canonicalUrl — an upstream `url` field is caller-influenced
 * data from a third-party API and must not be trusted verbatim.
 */
function resolvePaperUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname !== TRUSTED_PAPER_URL_HOSTNAME) return null
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}

/**
 * `paperId` is mandatory for a normalized document — it is Semantic
 * Scholar's stable identifier, and title is never used as a fallback since
 * titles are not stable and are not unique. Returns null (skip this record)
 * when `paperId` is missing or empty.
 */
function normalizePaper(paper: SsPaper): ReturnType<typeof makeDocument> | null {
  const id = typeof paper.paperId === 'string' && paper.paperId.trim() ? paper.paperId.trim() : null
  if (!id) return null

  const title = typeof paper.title === 'string' && paper.title.trim() ? paper.title.trim() : 'Untitled paper'
  const authors = normalizeAuthors(paper.authors)
  const doi = resolveDoi(paper.externalIds)
  const canonicalUrl = resolvePaperUrl(paper.url)
  // A bare year (e.g. "2024") is preserved as-is — never expanded into a
  // fabricated YYYY-MM-DD date, since only the year is actually known.
  const publishedAt = typeof paper.year === 'number' && Number.isFinite(paper.year) ? String(paper.year) : null

  return makeDocument({
    id: `semantic_scholar:${id}`,
    provider: PROVIDER,
    providerRecordId: id,
    title,
    // Missing abstracts are preserved as missing (null), never fabricated.
    summary: typeof paper.abstract === 'string' ? paper.abstract : null,
    contentSnippet: typeof paper.abstract === 'string' ? paper.abstract : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Semantic Scholar',
    contentType: 'scholarly_paper',
    authors,
    organization: typeof paper.venue === 'string' ? paper.venue : null,
    publishedAt,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: {
      semantic_scholar_paper_id: id,
      ...(doi ? { doi } : {}),
    },
    subjects: [],
    license: null,
    accessStatus: 'unknown',
  })
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, MAX_QUERY_TEXT_LENGTH)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `semantic_scholar:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/paper/search`)
  url.searchParams.set('query', text)
  url.searchParams.set('fields', FIELDS)
  url.searchParams.set('limit', String(limit))
  // offset is intentionally fixed at 0; `next`/`token` from the response is never followed.

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: authHeaders(), timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const parsed = safeJsonParse<SsSearchResponse>(result.text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Semantic Scholar response was not a valid JSON object.' }
  }
  // `data` must be an explicit array — missing, null, or any non-array shape
  // is a malformed upstream response, never a fabricated empty success.
  if (!Array.isArray(parsed.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Semantic Scholar response "data" field was missing or not an array.' }
  }

  const papers = parsed.data.slice(0, MAX_RESULTS)
  const documents = papers.map(normalizePaper).filter((doc): doc is NonNullable<typeof doc> => doc !== null)
  if (papers.length > 0 && documents.length === 0) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Semantic Scholar response contained records but none had a usable paperId.' }
  }
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') {
        throw new SemanticScholarError(`Semantic Scholar search failed with HTTP ${outcome.status}`, 'upstream_error')
      }
      throw new SemanticScholarError(outcome.message, 'parse_error')
    })
  } catch (error) {
    if (error instanceof SemanticScholarError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: error.category, message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/paper/search?query=test&limit=1&fields=paperId`, { headers: authHeaders(), timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : result.status === 429 ? 'rate_limited' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'paper search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const semanticScholarAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
