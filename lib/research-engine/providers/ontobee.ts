import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ontobee' as const
// Confirmed live: ontobee.org/sparql only serves an HTML query-builder page
// regardless of Accept header — the real SPARQL-JSON endpoint is
// sparql.hegroup.org/sparql.
const BASE_URL = 'https://sparql.hegroup.org/sparql'
const MAX_RESULTS = 25

function escapeSparqlLiteral(value: string): string {
  return value.replace(/["\\]/g, '')
}

type Binding = { s?: { value?: string }; label?: { value?: string } }
type SparqlResponse = { results?: { bindings?: Binding[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a term/label to search ontology entities for.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ontobee:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const sparql = `SELECT ?s ?label WHERE { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?label . FILTER(CONTAINS(LCASE(STR(?label)), "${escapeSparqlLiteral(text.toLowerCase())}")) } LIMIT ${limit}`
  const url = new URL(BASE_URL)
  url.searchParams.set('query', sparql)
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 20_000, headers: { Accept: 'application/sparql-results+json' } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SparqlResponse>(result.text)
  const bindings = data?.results?.bindings
  if (!Array.isArray(bindings)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Ontobee/HeGroup SPARQL response did not contain the expected results.bindings shape.' }
  }

  const documents = bindings
    .filter(b => typeof b.s?.value === 'string')
    .map(b => {
      const uri = b.s?.value as string
      return makeDocument({
        id: `ontobee:${uri}`,
        provider: PROVIDER,
        providerRecordId: uri,
        title: b.label?.value ?? uri,
        summary: null,
        contentSnippet: null,
        canonicalUrl: uri,
        sourceUrl: uri,
        sourceName: 'Ontobee',
        contentType: 'ontology_entity',
        authors: [],
        organization: 'University of Michigan',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { ontobee_uri: uri },
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
      if (outcome.kind === 'http_error') throw new Error(`Ontobee/HeGroup SPARQL search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = new URL(BASE_URL)
    url.searchParams.set('query', 'SELECT ?s WHERE { ?s a <http://www.w3.org/2002/07/owl#Class> } LIMIT 1')
    url.searchParams.set('format', 'json')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000, headers: { Accept: 'application/sparql-results+json' } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'SPARQL endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ontobeeAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
