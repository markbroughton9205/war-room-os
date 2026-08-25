import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'string_db' as const
const BASE_URL = 'https://string-db.org/api/json'
const DEFAULT_TAXON_ID = '9606' // human
const CALLER_IDENTITY = 'war_room_research_engine'
const MAX_RESULTS = 15

type ResolvedId = { stringId?: string; preferredName?: string; annotation?: string; taxonName?: string }
type InteractionPartner = { stringId_A?: string; stringId_B?: string; preferredName_A?: string; preferredName_B?: string; score?: number }

/** Query text is a gene symbol, optionally "<symbol> in <ncbiTaxonId>" to override the default (human, 9606). */
function parseQuery(text: string): { symbol: string; taxonId: string } {
  const match = /^(.+?)\s+in\s+(\d+)$/i.exec(text.trim())
  if (match) return { symbol: match[1].trim(), taxonId: match[2].trim() }
  return { symbol: text.trim(), taxonId: DEFAULT_TAXON_ID }
}

async function resolveStringId(symbol: string, taxonId: string): Promise<ResolvedId | null> {
  const url = `${BASE_URL}/get_string_ids?identifiers=${encodeURIComponent(symbol)}&species=${taxonId}&caller_identity=${CALLER_IDENTITY}`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 10_000 })
  if (!result.ok) return null
  const parsed = safeJsonParse<ResolvedId[]>(result.text)
  return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const { symbol, taxonId } = parseQuery(query.text)
  if (!symbol) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `string_db:${taxonId}:${symbol}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const resolved = await resolveStringId(symbol, taxonId)
  const resolvedStringId = resolved?.stringId
  if (!resolvedStringId) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }

  const partnersUrl = `${BASE_URL}/interaction_partners?identifiers=${encodeURIComponent(resolvedStringId)}&species=${taxonId}&limit=${limit}&caller_identity=${CALLER_IDENTITY}`
  const partnersResult = await safeProviderFetch(PROVIDER, partnersUrl, { timeoutMs: 12_000 })
  if (!partnersResult.ok) return { ok: false as const, kind: 'http_error' as const, status: partnersResult.status }

  const partners = safeJsonParse<InteractionPartner[]>(partnersResult.text)
  if (!Array.isArray(partners)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'STRING interaction_partners response was not an array.' }
  }

  const documents = partners
    .filter(p => p.stringId_B)
    .map(p => {
      const id = p.stringId_B as string
      const canonicalUrl = `https://string-db.org/network/${id}`
      return makeDocument({
        id: `string_db:${resolvedStringId}:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: `${resolved.preferredName ?? symbol} — ${p.preferredName_B ?? id} interaction`,
        summary: resolved.annotation ?? null,
        contentSnippet: typeof p.score === 'number' ? `Combined confidence score: ${p.score}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'STRING',
        contentType: 'protein_interaction',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: resolved.taxonName ?? null,
        language: null,
        identifiers: { string_id_a: resolvedStringId, string_id_b: id, ...(typeof p.score === 'number' ? { confidence_score: String(p.score) } : {}) },
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
      if (outcome.kind === 'http_error') throw new Error(`STRING interaction_partners failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/get_string_ids?identifiers=TP53&species=9606&caller_identity=${CALLER_IDENTITY}`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'get_string_ids reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const stringDbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
