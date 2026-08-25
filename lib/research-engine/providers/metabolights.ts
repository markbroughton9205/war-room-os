import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'metabolights' as const
const BASE_URL = 'https://www.ebi.ac.uk/metabolights/ws/studies'
const STUDY_ID_PATTERN = /^MTBLS\d+$/i

/** MetaboLights has no free-text keyword search (a /studies/search?query=
 * path 400s with "There is no study.", confirmed live) — only lookup by a
 * known study accession, same shape class as nomisma/hepdata/eclac_cepalstat. */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const studyId = query.text.trim().toUpperCase()
  if (!STUDY_ID_PATTERN.test(studyId)) {
    throw new Error('Query must be a MetaboLights study accession (e.g. "MTBLS1").')
  }
  const cacheKey = `metabolights:${studyId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const titleResult = await safeProviderFetch(PROVIDER, `${BASE_URL}/${studyId}/title`, { timeoutMs: 12_000 })
  if (!titleResult.ok) return { ok: false as const, kind: 'http_error' as const, status: titleResult.status }

  const titleData = safeJsonParse<{ title?: string }>(titleResult.text)
  if (!titleData?.title) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://www.ebi.ac.uk/metabolights/${studyId}`
  const documents = [makeDocument({
    id: `metabolights:${studyId}`,
    provider: PROVIDER,
    providerRecordId: studyId,
    title: titleData.title,
    summary: null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'MetaboLights',
    contentType: 'metabolomics_study',
    authors: [],
    organization: 'EMBL-EBI',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { metabolights_study_id: studyId },
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
      throw new Error(`MetaboLights lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/MTBLS1/title`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'title endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const metabolightsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
