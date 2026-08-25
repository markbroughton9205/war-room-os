import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ensembl' as const
const BASE_URL = 'https://rest.ensembl.org'
const DEFAULT_SPECIES = 'homo_sapiens'

type EnsemblGene = {
  id?: string
  display_name?: string
  description?: string
  biotype?: string
  species?: string
  seq_region_name?: string
  start?: number
  end?: number
  strand?: number
  object_type?: string
}

/** Query text is a gene symbol, optionally "<symbol> in <species>" to override the default human genome. */
function parseQuery(text: string): { symbol: string; species: string } {
  const match = /^(.+?)\s+in\s+([a-z_]+)$/i.exec(text.trim())
  if (match) return { symbol: match[1].trim(), species: match[2].trim().toLowerCase() }
  return { symbol: text.trim(), species: DEFAULT_SPECIES }
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const { symbol, species } = parseQuery(query.text)
  if (!symbol) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `ensembl:${species}:${symbol}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/lookup/symbol/${encodeURIComponent(species)}/${encodeURIComponent(symbol)}?content-type=application/json`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (result.status === 400 || result.status === 404) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const gene = safeJsonParse<EnsemblGene>(result.text)
  if (!gene || typeof gene !== 'object' || !gene.id) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Ensembl response was not a valid gene object.' }
  }

  const canonicalUrl = `https://www.ensembl.org/${species}/Gene/Summary?g=${gene.id}`
  const documents = [makeDocument({
    id: `ensembl:${gene.id}`,
    provider: PROVIDER,
    providerRecordId: gene.id,
    title: gene.display_name ?? gene.id,
    summary: gene.description ?? null,
    contentSnippet: gene.seq_region_name ? `Chromosome ${gene.seq_region_name}:${gene.start}-${gene.end}` : null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Ensembl',
    contentType: 'gene_record',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { ensembl_gene_id: gene.id, species: gene.species ?? species },
    subjects: gene.biotype ? [gene.biotype] : [],
    license: null,
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
      if (outcome.kind === 'http_error') throw new Error(`Ensembl lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/lookup/symbol/homo_sapiens/BRCA2?content-type=application/json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'lookup endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ensemblAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
