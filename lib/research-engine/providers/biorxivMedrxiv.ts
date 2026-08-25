import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'biorxiv_medrxiv' as const
const BASE_URL = 'https://api.biorxiv.org/details'
const DOI_PATTERN = /^(?:doi:)?(10\.\d{4,9}\/\S+)$/i

type PreprintEntry = {
  title?: string
  authors?: string
  doi?: string
  date?: string
  version?: string
  license?: string
  category?: string
  abstract?: string
}
type DetailsResponse = { messages?: { status?: string }[]; collection?: PreprintEntry[] }

/** Query text is "[medrxiv:]<doi>" (defaults to the biorxiv server). */
function parseQuery(text: string): { server: string; doi: string } | null {
  const trimmed = text.trim()
  const serverMatch = /^(medrxiv|biorxiv):(.+)$/i.exec(trimmed)
  const server = serverMatch ? serverMatch[1].toLowerCase() : 'biorxiv'
  const rawDoi = serverMatch ? serverMatch[2] : trimmed
  const doiMatch = DOI_PATTERN.exec(rawDoi.trim())
  if (!doiMatch) return null
  return { server, doi: doiMatch[1] }
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const parsed = parseQuery(query.text)
  if (!parsed) {
    throw new Error('Query must be a DOI, optionally prefixed "medrxiv:" (defaults to biorxiv), e.g. "10.1101/339747" or "medrxiv:10.1101/...".')
  }
  const cacheKey = `biorxiv_medrxiv:${parsed.server}:${parsed.doi}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // The DOI's internal "/" must stay literal in the path — encodeURIComponent
  // would percent-encode it and break bioRxiv's routing (confirmed live:
  // an encoded slash 404s where the literal slash succeeds). The DOI regex
  // above already bounds this to a safe DOI-shaped string.
  const url = `${BASE_URL}/${parsed.server}/${parsed.doi}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<DetailsResponse>(result.text)
  if (!data || !Array.isArray(data.collection)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'bioRxiv/medRxiv response "collection" field was missing or not an array.' }
  }
  // messages[0].status === "no posts found" is an honest empty result, not an error.
  if (data.collection.length === 0) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const entry = data.collection[data.collection.length - 1] // latest version
  const canonicalUrl = `https://www.${parsed.server}.org/content/${parsed.doi}`
  const documents = [makeDocument({
    id: `biorxiv_medrxiv:${parsed.server}:${parsed.doi}`,
    provider: PROVIDER,
    providerRecordId: parsed.doi,
    title: entry.title ?? parsed.doi,
    summary: entry.abstract ?? null,
    contentSnippet: entry.category ? `Category: ${entry.category}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: parsed.server === 'medrxiv' ? 'medRxiv' : 'bioRxiv',
    contentType: 'preprint',
    authors: entry.authors ? entry.authors.split(';').map(a => a.trim()).filter(Boolean) : [],
    organization: null,
    publishedAt: entry.date ?? null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { doi: parsed.doi, ...(entry.version ? { version: entry.version } : {}) },
    subjects: [],
    license: entry.license ?? null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`bioRxiv/medRxiv fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/biorxiv/10.1101/339747`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'details endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const biorxivMedrxivAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
