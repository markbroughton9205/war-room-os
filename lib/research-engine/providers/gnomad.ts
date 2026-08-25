import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'gnomad' as const
const BASE_URL = 'https://gnomad.broadinstitute.org/api'

type GnomadGene = { gene_id?: string; symbol?: string; chrom?: string; start?: number; stop?: number }
type GnomadResponse = { data?: { gene?: GnomadGene } }

// Small, fixed GraphQL query shape — no arbitrary caller-supplied GraphQL is
// ever exposed, matching this codebase's wikidata (no arbitrary SPARQL) convention.
function buildQuery(symbol: string): string {
  return JSON.stringify({
    query: `query { gene(gene_symbol: "${symbol.replace(/"/g, '')}", reference_genome: GRCh38) { gene_id symbol chrom start stop } }`,
  })
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const symbol = query.text.trim().slice(0, 50)
  if (!symbol) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `gnomad:gene:${symbol}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildQuery(symbol),
    timeoutMs: 12_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GnomadResponse>(result.text)
  const gene = data?.data?.gene
  if (!gene || !gene.gene_id) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://gnomad.broadinstitute.org/gene/${gene.gene_id}`
  const documents = [makeDocument({
    id: `gnomad:${gene.gene_id}`,
    provider: PROVIDER,
    providerRecordId: gene.gene_id,
    title: gene.symbol ?? gene.gene_id,
    summary: gene.chrom ? `Chromosome ${gene.chrom}:${gene.start}-${gene.stop} (GRCh38)` : null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'gnomAD',
    contentType: 'population_genetics_record',
    authors: [],
    organization: 'Broad Institute',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { ensembl_gene_id: gene.gene_id },
    subjects: [],
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
      throw new Error(`gnomAD GraphQL query failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: buildQuery('TP53'), timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'GraphQL endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const gnomadAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
