import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'metabolomics_workbench' as const
const BASE_URL = 'https://www.metabolomicsworkbench.org/rest/study/study_title'
const MAX_RESULTS = 25

type Study = {
  study_id?: string
  study_title?: string
  species?: string
  institute?: string
  analysis_type?: string
  submission_date?: string
}
// Response is a numeric-keyed object ("1","2",...), not a JSON array
// (confirmed live) — iterated with Object.values().
type SearchResponse = Record<string, Study>

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a study title keyword (e.g. "diabetes").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `metabolomics_workbench:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/${encodeURIComponent(text)}/summary`, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = Object.values(data)
    .slice(0, limit)
    .filter(s => typeof s.study_id === 'string')
    .map(s => {
      const studyId = s.study_id as string
      const canonicalUrl = `https://www.metabolomicsworkbench.org/data/DRCCStudySummary.php?Mode=SetupRawDataDownload&StudyID=${studyId}`
      return makeDocument({
        id: `metabolomics_workbench:${studyId}`,
        provider: PROVIDER,
        providerRecordId: studyId,
        title: s.study_title ?? studyId,
        summary: s.institute ? `Institute: ${s.institute}` : null,
        contentSnippet: s.analysis_type ? `Analysis: ${s.analysis_type}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Metabolomics Workbench',
        contentType: 'metabolomics_study',
        authors: [],
        organization: s.institute ?? 'NIH Common Fund',
        publishedAt: s.submission_date ?? null,
        updatedAt: null,
        geography: s.species ?? null,
        language: 'en',
        identifiers: { metabolomics_workbench_study_id: studyId },
        subjects: s.species ? [s.species] : [],
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
      throw new Error(`Metabolomics Workbench search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/diabetes/summary`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'study summary endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const metabolomicsWorkbenchAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
