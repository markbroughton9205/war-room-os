import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'orcid' as const
const TOKEN_URL = 'https://orcid.org/oauth/token'
const SEARCH_URL = 'https://pub.orcid.org/v3.0/expanded-search'
const MAX_RESULTS = 20

type OrcidTokenResponse = { access_token?: string; expires_in?: number }
type OrcidSearchResult = { 'orcid-id'?: string; 'given-names'?: string; 'family-names'?: string; 'credit-name'?: string; 'institution-name'?: string[] }
type OrcidSearchResponse = { 'expanded-result'?: OrcidSearchResult[]; 'num-found'?: number }

// Module-level token cache: ORCID client-credentials tokens are documented
// as long-lived in practice, but `expires_in` is still honored rather than
// hardcoded — mirrors the throttle-state pattern already used by arxiv.ts.
let cachedToken: { value: string; expiresAt: number } | null = null

async function fetchAccessToken(): Promise<{ ok: true; token: string } | { ok: false; status: number | null }> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return { ok: true, token: cachedToken.value }

  const clientId = process.env.ORCID_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.ORCID_CLIENT_SECRET?.trim() ?? ''
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: '/read-public' })

  const result = await safeProviderFetch(PROVIDER, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeoutMs: 10_000,
  })
  if (!result.ok) return { ok: false, status: result.status }

  const data = safeJsonParse<OrcidTokenResponse>(result.text)
  if (!data?.access_token) return { ok: false, status: null }
  const ttlMs = Math.max(60_000, (data.expires_in ?? 3600) * 1000 - 60_000)
  cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs }
  return { ok: true, token: data.access_token }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `orcid:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const tokenOutcome = await fetchAccessToken()
  if (!tokenOutcome.ok) return { ok: false as const, kind: 'auth_error' as const, status: tokenOutcome.status }

  const url = new URL(SEARCH_URL + '/')
  url.searchParams.set('q', text)
  url.searchParams.set('start', '0')
  url.searchParams.set('rows', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), {
    headers: { Authorization: `Bearer ${tokenOutcome.token}`, Accept: 'application/json' },
    timeoutMs: 12_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OrcidSearchResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'ORCID response was not a valid JSON object.' }
  }
  const results = Array.isArray(data['expanded-result']) ? data['expanded-result']! : []

  const documents = results
    .filter(row => row['orcid-id'])
    .map(row => {
      const orcidId = row['orcid-id'] as string
      const canonicalUrl = `https://orcid.org/${orcidId}`
      const name = row['credit-name'] || [row['given-names'], row['family-names']].filter(Boolean).join(' ') || orcidId
      return makeDocument({
        id: `orcid:${orcidId}`,
        provider: PROVIDER,
        providerRecordId: orcidId,
        title: name,
        summary: row['institution-name']?.length ? `Affiliations: ${row['institution-name'].join(', ')}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ORCID',
        contentType: 'researcher_identity',
        authors: [name],
        organization: row['institution-name']?.[0] ?? null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { orcid_id: orcidId },
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
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'ORCID_CLIENT_ID / ORCID_CLIENT_SECRET are not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'auth_error') throw new Error(`ORCID OAuth token request failed${outcome.status ? ` with HTTP ${outcome.status}` : ''}`)
      if (outcome.kind === 'http_error') throw new Error(`ORCID search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'ORCID_CLIENT_ID / ORCID_CLIENT_SECRET missing', durationMs: null }
  }
  try {
    const tokenOutcome = await fetchAccessToken()
    if (!tokenOutcome.ok) {
      return { provider: PROVIDER, state: 'authentication_failed', checkedAt: nowIso(), detail: 'OAuth token request failed', durationMs: Date.now() - started }
    }
    return { provider: PROVIDER, state: 'ready', checkedAt: nowIso(), detail: 'OAuth token acquired', durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const orcidAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
