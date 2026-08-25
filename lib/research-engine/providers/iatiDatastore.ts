import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'iati_datastore' as const
const BASE_URL = 'https://api.iatistandard.org/datastore/activity/select'
const MAX_RESULTS = 25

// Auth mechanism (Ocp-Apim-Subscription-Key header, 401 without/with-wrong
// key) confirmed live this mission via a free self-service "Exploratory"
// subscription at developer.iatistandard.org. The Solr-standard response
// shape below (response.docs[]) matches IATI's published Solr schema but
// was NOT independently re-verified live (no key available this build) —
// recommend one live-verification pass once a Commander registers a key.
type SolrDoc = {
  iati_identifier?: string
  title_narrative?: string[]
  description_narrative?: string[]
  reporting_org_narrative?: string[]
  activity_status_code?: string
  start_date_actual_iso_date?: string
}
type SolrResponse = { response?: { numFound?: number; docs?: SolrDoc[] } }

function apiKey(): string {
  return process.env.IATI_DATASTORE_SUBSCRIPTION_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `iati_datastore:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', `description_narrative:${text}`)
  url.searchParams.set('rows', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000, headers: { 'Ocp-Apim-Subscription-Key': apiKey() } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SolrResponse>(result.text)
  if (!data || !Array.isArray(data.response?.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'IATI Datastore response "response.docs" field was missing or not an array.' }
  }

  const documents = data.response.docs
    .filter(doc => typeof doc.iati_identifier === 'string')
    .map(doc => {
      const id = doc.iati_identifier as string
      const canonicalUrl = `https://d-portal.org/ctrack.html?aid=${encodeURIComponent(id)}`
      return makeDocument({
        id: `iati_datastore:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: doc.title_narrative?.[0] ?? id,
        summary: doc.description_narrative?.[0] ?? null,
        contentSnippet: doc.reporting_org_narrative?.[0] ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'IATI Datastore',
        contentType: 'aid_activity',
        authors: [],
        organization: doc.reporting_org_narrative?.[0] ?? null,
        publishedAt: doc.start_date_actual_iso_date ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { iati_identifier: id },
        subjects: doc.activity_status_code ? [doc.activity_status_code] : [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'IATI_DATASTORE_SUBSCRIPTION_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`IATI Datastore search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'IATI_DATASTORE_SUBSCRIPTION_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=description_narrative:health&rows=1`, { timeoutMs: 10_000, headers: { 'Ocp-Apim-Subscription-Key': apiKey() } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'activity select endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const iatiDatastoreAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
