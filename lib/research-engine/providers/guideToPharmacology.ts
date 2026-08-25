import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'guide_to_pharmacology' as const
const BASE_URL = 'https://www.guidetopharmacology.org/services/ligands'
const MAX_RESULTS = 25

type Ligand = {
  ligandId?: number
  name?: string
  type?: string
  inn?: string
  approved?: boolean
  withdrawn?: boolean
  radioactive?: boolean
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a ligand/drug name (e.g. "aspirin").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `guide_to_pharmacology:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('name', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Ligand[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = data
    .slice(0, limit)
    .filter(l => l.ligandId != null)
    .map(l => {
      const id = String(l.ligandId)
      const canonicalUrl = `https://www.guidetopharmacology.org/GRAC/LigandDisplayForward?ligandId=${id}`
      return makeDocument({
        id: `guide_to_pharmacology:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: l.name ?? `Ligand ${id}`,
        summary: l.type ? `Type: ${l.type}` : null,
        contentSnippet: [l.approved ? 'approved' : null, l.withdrawn ? 'withdrawn' : null, l.radioactive ? 'radioactive' : null].filter(Boolean).join(', ') || null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Guide to Pharmacology (IUPHAR/BPS)',
        contentType: 'pharmacology_ligand',
        authors: [],
        organization: 'IUPHAR/BPS',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { gtp_ligand_id: id, ...(l.inn ? { inn: l.inn } : {}) },
        subjects: l.type ? [l.type] : [],
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
      throw new Error(`Guide to Pharmacology search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?name=aspirin`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'ligands endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const guideToPharmacologyAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
