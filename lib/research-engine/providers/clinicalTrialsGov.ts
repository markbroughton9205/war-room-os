import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'clinicaltrials_gov' as const
const BASE_URL = 'https://clinicaltrials.gov/api/v2'
const MAX_RESULTS = 25

type CtStudy = {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string }
    statusModule?: { overallStatus?: string; lastUpdatePostDateStruct?: { date?: string } }
    conditionsModule?: { conditions?: string[] }
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } }
  }
}
type CtResponse = { studies?: CtStudy[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 300)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `clinicaltrials_gov:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/studies`)
  if (text) url.searchParams.set('query.term', text)
  url.searchParams.set('pageSize', String(limit))
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CtResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.studies)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ClinicalTrials.gov response "studies" field was missing or not an array.' }
  }

  const documents = data.studies
    .map(study => {
      const id = study.protocolSection?.identificationModule
      const status = study.protocolSection?.statusModule
      const nctId = id?.nctId ?? null
      if (!nctId) return null
      const canonicalUrl = `https://clinicaltrials.gov/study/${nctId}`
      return makeDocument({
        id: `clinicaltrials_gov:${nctId}`,
        provider: PROVIDER,
        providerRecordId: nctId,
        title: id?.briefTitle ?? nctId,
        summary: null,
        contentSnippet: status?.overallStatus ? `Status: ${status.overallStatus}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ClinicalTrials.gov',
        contentType: 'clinical_trial_record',
        authors: [],
        organization: study.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
        publishedAt: null,
        updatedAt: status?.lastUpdatePostDateStruct?.date ?? null,
        geography: null,
        language: 'en',
        identifiers: { nct_id: nctId },
        subjects: study.protocolSection?.conditionsModule?.conditions ?? [],
        license: null,
        accessStatus: 'open',
      })
    })
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`ClinicalTrials.gov search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/studies?pageSize=1&format=json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'studies endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const clinicalTrialsGovAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
