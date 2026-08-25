import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'uniprot' as const
const BASE_URL = 'https://rest.uniprot.org'
const MAX_RESULTS = 25

type UpEntry = {
  primaryAccession?: string
  uniProtkbId?: string
  entryType?: string
  organism?: { scientificName?: string }
  proteinDescription?: { recommendedName?: { fullName?: { value?: string } } }
}
type UpResponse = { results?: UpEntry[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 300)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `uniprot:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/uniprotkb/search`)
  url.searchParams.set('query', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('fields', 'accession,id,protein_name,organism_name')
  url.searchParams.set('size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<UpResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'UniProt response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(row => typeof row.primaryAccession === 'string' && row.primaryAccession)
    .map(row => {
      const accession = row.primaryAccession as string
      const canonicalUrl = `https://www.uniprot.org/uniprotkb/${accession}/entry`
      const proteinName = row.proteinDescription?.recommendedName?.fullName?.value ?? row.uniProtkbId ?? accession
      return makeDocument({
        id: `uniprot:${accession}`,
        provider: PROVIDER,
        providerRecordId: accession,
        title: proteinName,
        summary: row.organism?.scientificName ? `Organism: ${row.organism.scientificName}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'UniProt',
        contentType: 'protein_entry',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { uniprot_accession: accession, ...(row.uniProtkbId ? { uniprot_id: row.uniProtkbId } : {}) },
        subjects: row.organism?.scientificName ? [row.organism.scientificName] : [],
        license: null,
        accessStatus: row.entryType?.toLowerCase().includes('unreviewed') ? 'unknown' : 'open',
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
      if (outcome.kind === 'http_error') throw new Error(`UniProt search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/uniprotkb/search?query=insulin&format=json&size=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const uniprotAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
