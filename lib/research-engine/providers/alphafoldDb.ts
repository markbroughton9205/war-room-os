import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'alphafold_db' as const
const BASE_URL = 'https://alphafold.ebi.ac.uk/api/prediction'
const UNIPROT_ACCESSION_PATTERN = /^[A-Z][A-Z0-9]{5,9}$/i
// Confirmed live: Node's default fetch User-Agent gets a real 403 from this
// host's edge (curl with any UA succeeds) — a descriptive UA is required.
const USER_AGENT = 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)'

type Prediction = {
  uniprotAccession?: string
  uniprotId?: string
  uniprotDescription?: string
  gene?: string
  organismScientificName?: string
  globalMetricValue?: number
  cifUrl?: string
  pdbUrl?: string
  modelCreatedDate?: string
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const accession = query.text.trim().toUpperCase()
  if (!UNIPROT_ACCESSION_PATTERN.test(accession)) {
    throw new Error('Query must be a UniProt accession (e.g. "P69905").')
  }
  const cacheKey = `alphafold_db:${accession}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${accession}`, { timeoutMs: 12_000, headers: { 'User-Agent': USER_AGENT } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  // A no-model accession returns an empty array, not an object — confirmed
  // live; treated as an honest empty result, not malformed.
  const data = safeJsonParse<Prediction[]>(result.text)
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const pred = data[0]
  const canonicalUrl = `https://alphafold.ebi.ac.uk/entry/${accession}`
  const documents = [makeDocument({
    id: `alphafold_db:${accession}`,
    provider: PROVIDER,
    providerRecordId: accession,
    title: pred.uniprotDescription ?? pred.uniprotId ?? accession,
    summary: typeof pred.globalMetricValue === 'number' ? `Mean pLDDT confidence: ${pred.globalMetricValue.toFixed(1)}` : null,
    contentSnippet: pred.gene ? `Gene: ${pred.gene}` : null,
    canonicalUrl,
    sourceUrl: pred.cifUrl ?? canonicalUrl,
    sourceName: 'AlphaFold Protein Structure Database',
    contentType: 'protein_structure_prediction',
    authors: [],
    organization: 'EMBL-EBI / DeepMind',
    publishedAt: pred.modelCreatedDate ?? null,
    updatedAt: null,
    geography: null,
    language: null,
    identifiers: { uniprot_accession: accession },
    subjects: pred.organismScientificName ? [pred.organismScientificName] : [],
    license: 'CC-BY-4.0',
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
      throw new Error(`AlphaFold DB lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/P69905`, { timeoutMs: 8_000, headers: { 'User-Agent': USER_AGENT } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'prediction endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const alphafoldDbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
