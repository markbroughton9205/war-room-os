import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ncbi_datasets' as const
const BASE_URL = 'https://api.ncbi.nlm.nih.gov/datasets/v2'
const SYMBOL_PATTERN = /^([A-Za-z0-9._-]+)(?::(.+))?$/

type Gene = {
  gene_id?: string
  symbol?: string
  description?: string
  tax_id?: string
  taxname?: string
  synonyms?: string[]
}
type Report = { gene?: Gene }
type ReportsResponse = { reports?: Report[] }

/** Query text is "SYMBOL" or "SYMBOL:taxon" (taxon defaults to "human"). */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const match = SYMBOL_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be a gene symbol (e.g. "BRCA2" or "BRCA2:mouse").')
  const symbol = match[1]
  const taxon = match[2] ?? 'human'
  const cacheKey = `ncbi_datasets:${symbol}:${taxon}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/gene/symbol/${encodeURIComponent(symbol)}/taxon/${encodeURIComponent(taxon)}`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ReportsResponse>(result.text)
  if (!data || !Array.isArray(data.reports)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = data.reports
    .filter(r => r.gene?.gene_id != null)
    .map(r => {
      const gene = r.gene as Gene
      const geneId = gene.gene_id as string
      const canonicalUrl = `https://www.ncbi.nlm.nih.gov/gene/${geneId}`
      return makeDocument({
        id: `ncbi_datasets:${geneId}`,
        provider: PROVIDER,
        providerRecordId: geneId,
        title: gene.symbol ?? geneId,
        summary: gene.description ?? null,
        contentSnippet: gene.taxname ? `Organism: ${gene.taxname}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NCBI Datasets',
        contentType: 'gene_record',
        authors: [],
        organization: 'NCBI',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { ncbi_gene_id: geneId, ...(gene.symbol ? { gene_symbol: gene.symbol } : {}) },
        subjects: gene.synonyms?.slice(0, 10) ?? [],
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
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`NCBI Datasets lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/gene/symbol/BRCA2/taxon/human`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'gene report endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ncbiDatasetsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
