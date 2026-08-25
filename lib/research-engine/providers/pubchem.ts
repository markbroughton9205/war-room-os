import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'pubchem' as const
const BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
// PubChem's current PUG REST schema exposes "ConnectivitySMILES", not the
// older "CanonicalSMILES" property name (confirmed live during build).
const PROPERTIES = 'MolecularFormula,MolecularWeight,IUPACName,ConnectivitySMILES'

type PcProperty = { CID?: number; MolecularFormula?: string; MolecularWeight?: string; IUPACName?: string; ConnectivitySMILES?: string }
type PcResponse = { PropertyTable?: { Properties?: PcProperty[] } }

async function lookup(name: string) {
  const started = Date.now()
  const cacheKey = `pubchem:name:${name}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/compound/name/${encodeURIComponent(name)}/property/${PROPERTIES}/JSON`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 12_000 })
  if (result.status === 404) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<PcResponse>(result.text)
  const rows = data?.PropertyTable?.Properties
  if (!Array.isArray(rows)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'PubChem response "PropertyTable.Properties" field was missing or not an array.' }
  }

  const documents = rows
    .filter(row => typeof row.CID === 'number')
    .map(row => {
      const cid = String(row.CID)
      const canonicalUrl = `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`
      return makeDocument({
        id: `pubchem:${cid}`,
        provider: PROVIDER,
        providerRecordId: cid,
        title: row.IUPACName ?? name,
        summary: row.MolecularFormula ? `Molecular formula ${row.MolecularFormula}, weight ${row.MolecularWeight ?? 'unknown'}` : null,
        contentSnippet: row.ConnectivitySMILES ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'PubChem',
        contentType: 'chemical_compound',
        authors: [],
        organization: 'NCBI',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { pubchem_cid: cid, ...(row.MolecularFormula ? { molecular_formula: row.MolecularFormula } : {}) },
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
  const name = query.text.trim().slice(0, 200)
  if (!name) return okResponse(PROVIDER, { documents: [], durationMs: 0 })
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(name)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`PubChem lookup failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/compound/name/water/property/MolecularFormula/JSON`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'compound lookup reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const pubchemAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
