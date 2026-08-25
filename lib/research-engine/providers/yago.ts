import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'yago' as const
const SPARQL_URL = 'https://yago-knowledge.org/sparql/qlever'
const MAX_RESULTS = 20

type SparqlBinding = { entity?: { value?: string }; label?: { value?: string } }
type SparqlResponse = { results?: { bindings?: SparqlBinding[] } }

/** Escapes a caller's text for safe interpolation into a SPARQL string literal. */
function escapeSparqlLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `yago:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const literal = escapeSparqlLiteral(text)
  const sparql = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?entity ?label WHERE {
  ?entity rdfs:label ?label .
  FILTER(CONTAINS(LCASE(STR(?label)), LCASE("${literal}")))
} LIMIT ${limit}`

  const url = new URL(SPARQL_URL)
  url.searchParams.set('query', sparql)

  const result = await safeProviderFetch(PROVIDER, url.toString(), {
    headers: { Accept: 'application/sparql-results+json' },
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SparqlResponse>(result.text)
  const bindings = data?.results?.bindings ?? []
  const documents = bindings
    .filter(binding => binding.entity?.value)
    .map(binding => {
      const entityUri = binding.entity!.value as string
      const id = entityUri.split(/[/#]/).pop() ?? entityUri
      return makeDocument({
        id: `yago:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: binding.label?.value ?? id,
        summary: null,
        contentSnippet: null,
        canonicalUrl: entityUri,
        sourceUrl: entityUri,
        sourceName: 'YAGO Knowledge Base',
        contentType: 'knowledge_graph_entity',
        authors: [],
        organization: 'Max Planck Institute for Informatics',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { yago_uri: entityUri },
        subjects: [],
        license: 'CC BY 4.0',
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
      throw new Error(`YAGO SPARQL query failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = new URL(SPARQL_URL)
    url.searchParams.set('query', 'SELECT ?e WHERE { ?e a <http://schema.org/Person> } LIMIT 1')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { Accept: 'application/sparql-results+json' }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'SPARQL endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const yagoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
