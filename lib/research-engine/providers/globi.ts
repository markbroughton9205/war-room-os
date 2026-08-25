import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'globi' as const
// The commonly-documented /taxon/{name}/interactions path 500s (confirmed
// live: "unsupported interaction type") — the real working endpoint is
// /interaction?sourceTaxon=.
const BASE_URL = 'https://api.globalbioticinteractions.org/interaction'
const MAX_RESULTS = 25

type InteractionResponse = { columns?: string[]; data?: (string | number | null)[][] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a source taxon name (e.g. "Homo sapiens").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `globi:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('sourceTaxon', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<InteractionResponse>(result.text)
  const columns = data?.columns
  const rows = data?.data
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'GloBI response "columns"/"data" fields were missing.' }
  }

  const colIndex = (name: string) => columns.indexOf(name)
  const sourceIdx = colIndex('source_taxon_name')
  const typeIdx = colIndex('interaction_type')
  const targetIdx = colIndex('target_taxon_name')
  const studyIdx = colIndex('study_title')

  const documents = rows
    .slice(0, limit)
    .map((row, index) => {
      const source = sourceIdx >= 0 ? row[sourceIdx] : text
      const type = typeIdx >= 0 ? row[typeIdx] : 'interactsWith'
      const target = targetIdx >= 0 ? row[targetIdx] : null
      const canonicalUrl = 'https://www.globalbioticinteractions.org/'
      return makeDocument({
        id: `globi:${text}:${index}`,
        provider: PROVIDER,
        providerRecordId: `${text}:${index}`,
        title: `${source} — ${type} — ${target ?? 'unknown'}`,
        summary: studyIdx >= 0 && row[studyIdx] ? String(row[studyIdx]) : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'GloBI (Global Biotic Interactions)',
        contentType: 'species_interaction',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: {},
        subjects: typeof type === 'string' ? [type] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`GloBI search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?sourceTaxon=Homo+sapiens`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'interaction endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const globiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
