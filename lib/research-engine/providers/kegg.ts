import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'kegg' as const
const BASE_URL = 'https://rest.kegg.jp'
const MAX_RESULTS = 25

/** KEGG's REST API returns flat tab-separated text, not JSON (confirmed
 * live) — one hit per line: "{kegg_id}\t{description}". */
function parseFindResults(text: string): { id: string; description: string }[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [id, ...rest] = line.split('\t')
      return { id, description: rest.join('\t') }
    })
    .filter(row => row.id)
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a gene/pathway/compound name (e.g. "BRCA2").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `kegg:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/find/genes/${encodeURIComponent(text)}`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const rows = parseFindResults(result.text).slice(0, limit)
  const documents = rows.map(row => {
    const canonicalUrl = `https://www.kegg.jp/entry/${row.id}`
    const [symbolPart, ...descParts] = row.description.split(';')
    return makeDocument({
      id: `kegg:${row.id}`,
      provider: PROVIDER,
      providerRecordId: row.id,
      title: symbolPart?.trim() || row.id,
      summary: descParts.join(';').trim() || null,
      contentSnippet: null,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'KEGG',
      contentType: 'gene_record',
      authors: [],
      organization: 'Kyoto Encyclopedia of Genes and Genomes',
      publishedAt: null,
      updatedAt: null,
      geography: null,
      language: null,
      identifiers: { kegg_id: row.id },
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
      throw new Error(`KEGG search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/find/genes/BRCA2`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'find endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const keggAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
