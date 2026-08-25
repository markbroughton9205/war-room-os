import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'bindingdb' as const
const BASE_URL = 'https://bindingdb.org/rest/getLigandsByUniprot'
const UNIPROT_ACCESSION_PATTERN = /^[A-Z][A-Z0-9]{5,9}$/i
const MAX_RESULTS = 25

// bdb.monomerid is a JSON number upstream (confirmed live), not a string —
// coerced to a string for use as a document identifier.
type Affinity = { 'bdb.monomerid'?: number | string; 'bdb.smile'?: string; 'bdb.affinity_type'?: string; 'bdb.affinity'?: string }
// The real key is "getLindsByUniprotResponse" (misspelled upstream, confirmed live) — not corrected here, matches the real payload.
type BindingDbResponse = { getLindsByUniprotResponse?: { 'bdb.affinities'?: Affinity[] } }

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const accession = query.text.trim().toUpperCase()
  if (!UNIPROT_ACCESSION_PATTERN.test(accession)) {
    throw new Error('Query must be a UniProt accession (e.g. "P00533").')
  }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `bindingdb:${accession}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('uniprot', accession)
  url.searchParams.set('response', 'application/json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 20_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<BindingDbResponse>(result.text)
  const affinities = data?.getLindsByUniprotResponse?.['bdb.affinities']
  if (!Array.isArray(affinities)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://bindingdb.org/rwd/bind/byuniprot.jsp?uniprot=${accession}`
  const documents = affinities
    .slice(0, limit)
    .filter(a => a['bdb.monomerid'] != null)
    .map(a => {
      const monomerId = String(a['bdb.monomerid'])
      return makeDocument({
        id: `bindingdb:${accession}:${monomerId}`,
        provider: PROVIDER,
        providerRecordId: `${accession}:${monomerId}`,
        title: `Ligand ${monomerId} — ${accession}`,
        summary: a['bdb.smile'] ? `SMILES: ${a['bdb.smile']}` : null,
        contentSnippet: a['bdb.affinity_type'] && a['bdb.affinity'] ? `${a['bdb.affinity_type']}: ${a['bdb.affinity']}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'BindingDB',
        contentType: 'protein_ligand_binding_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { bindingdb_monomer_id: monomerId, uniprot_accession: accession },
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
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`BindingDB lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?uniprot=P00533&response=application/json`, { timeoutMs: 15_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'ligands endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const bindingdbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
