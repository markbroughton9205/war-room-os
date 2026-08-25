import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'chembl' as const
const BASE_URL = 'https://www.ebi.ac.uk/chembl/api/data'
const MAX_RESULTS = 20

type ChemblMolecule = {
  molecule_chembl_id?: string
  pref_name?: string | null
  max_phase?: string
  first_approval?: number
  molecule_properties?: { full_mwt?: string; full_molformula?: string }
  molecule_type?: string
  withdrawn_flag?: boolean
}
type ChemblResponse = { molecules?: ChemblMolecule[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `chembl:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/molecule/search`)
  url.searchParams.set('q', text)
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ChemblResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.molecules)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ChEMBL response "molecules" field was missing or not an array.' }
  }

  const documents = data.molecules
    .filter(mol => mol.molecule_chembl_id)
    .slice(0, limit)
    .map(mol => {
      const id = mol.molecule_chembl_id as string
      const canonicalUrl = `https://www.ebi.ac.uk/chembl/explore/compound/${id}`
      return makeDocument({
        id: `chembl:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: mol.pref_name ?? id,
        summary: mol.molecule_properties?.full_molformula ? `Formula ${mol.molecule_properties.full_molformula}, MW ${mol.molecule_properties.full_mwt ?? 'unknown'}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ChEMBL',
        contentType: 'bioactive_molecule',
        authors: [],
        organization: 'EMBL-EBI',
        publishedAt: mol.first_approval ? String(mol.first_approval) : null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: {
          chembl_id: id,
          ...(mol.max_phase ? { max_clinical_phase: mol.max_phase } : {}),
          ...(typeof mol.withdrawn_flag === 'boolean' ? { withdrawn: String(mol.withdrawn_flag) } : {}),
        },
        subjects: mol.molecule_type ? [mol.molecule_type] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`ChEMBL search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/molecule/search?q=aspirin&format=json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'molecule search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const chemblAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
