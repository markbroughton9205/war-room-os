import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'loinc_fhir' as const
const BASE_URL = 'https://fhir.loinc.org/CodeSystem/$lookup'
const LOINC_CODE_PATTERN = /^\d{1,5}-\d$/

// Auth mechanism (HTTP Basic Auth against Smile CDR, real 401 with
// WWW-Authenticate: Basic) confirmed live. Free self-service Regenstrief/
// LOINC account credentials used directly as Basic Auth. Response body
// shape for valid credentials not independently re-verified live (no
// credentials available this build).
type Parameter = { name?: string; valueString?: string; valueCode?: string }
type LookupResponse = { parameter?: Parameter[] }

function basicAuthHeader(): string {
  const user = process.env.LOINC_FHIR_USERNAME?.trim() ?? ''
  const pass = process.env.LOINC_FHIR_PASSWORD?.trim() ?? ''
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const code = query.text.trim()
  if (!LOINC_CODE_PATTERN.test(code)) {
    throw new Error('Query must be a LOINC code (e.g. "2093-3").')
  }
  const cacheKey = `loinc_fhir:${code}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('system', 'http://loinc.org')
  url.searchParams.set('code', code)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { Authorization: basicAuthHeader() }, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<LookupResponse>(result.text)
  const params = data?.parameter
  if (!Array.isArray(params)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const display = params.find(p => p.name === 'display')?.valueString
  const canonicalUrl = `https://loinc.org/${code}`
  const documents = [makeDocument({
    id: `loinc_fhir:${code}`,
    provider: PROVIDER,
    providerRecordId: code,
    title: display ?? code,
    summary: null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'LOINC',
    contentType: 'lab_terminology_code',
    authors: [],
    organization: 'Regenstrief Institute',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { loinc_code: code },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'LOINC_FHIR_USERNAME/LOINC_FHIR_PASSWORD are not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`LOINC FHIR lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'LOINC_FHIR_USERNAME/LOINC_FHIR_PASSWORD missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?system=http://loinc.org&code=2093-3`, { headers: { Authorization: basicAuthHeader() }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'lookup endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const loincFhirAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
