import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import { extractXmlBlocks, extractXmlText, extractXmlAttribute } from '@/lib/research-engine/security/xmlLite'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'epo_ops' as const
const TOKEN_URL = 'https://ops.epo.org/3.2/auth/accesstoken'
const SEARCH_URL = 'https://ops.epo.org/3.2/rest-services/published-data/search/biblio'
const MAX_RESULTS = 20

// Module-level token cache: EPO OPS tokens expire every 20 minutes — cached
// and refreshed the same way this codebase's orcid adapter caches its token.
let cachedToken: { value: string; expiresAt: number } | null = null

function credentials(): { key: string; secret: string } {
  return { key: process.env.EPO_OPS_CONSUMER_KEY?.trim() ?? '', secret: process.env.EPO_OPS_CONSUMER_SECRET?.trim() ?? '' }
}

async function fetchAccessToken(): Promise<{ ok: true; token: string } | { ok: false; status: number | null }> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return { ok: true, token: cachedToken.value }

  const { key, secret } = credentials()
  const basicAuth = Buffer.from(`${key}:${secret}`).toString('base64')
  const result = await safeProviderFetch(PROVIDER, TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    timeoutMs: 10_000,
  })
  if (!result.ok) return { ok: false, status: result.status }

  const tokenMatch = /"access_token"\s*:\s*"([^"]+)"/.exec(result.text) ?? /access_token=([^&\s]+)/.exec(result.text)
  if (!tokenMatch) return { ok: false, status: null }
  // 20-minute token TTL per EPO OPS docs, refreshed 60s early.
  cachedToken = { value: tokenMatch[1], expiresAt: Date.now() + 19 * 60_000 }
  return { ok: true, token: tokenMatch[1] }
}

/** Escapes a caller's text for safe interpolation into an EPO CQL query (no bind-parameter mechanism exists). */
function escapeCql(text: string): string {
  return text.replace(/["\\]/g, '')
}

function parseExchangeDocument(xml: string) {
  return {
    docNumber: extractXmlAttribute(xml, 'document-id', 'doc-number') ?? extractXmlText(xml, 'doc-number'),
    country: extractXmlAttribute(xml, 'document-id', 'country') ?? extractXmlText(xml, 'country'),
    kind: extractXmlAttribute(xml, 'document-id', 'kind') ?? extractXmlText(xml, 'kind'),
    title: extractXmlText(xml, 'invention-title'),
    date: extractXmlText(xml, 'date'),
  }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `epo_ops:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const tokenOutcome = await fetchAccessToken()
  if (!tokenOutcome.ok) return { ok: false as const, kind: 'auth_error' as const, status: tokenOutcome.status }

  const cql = `ti=${escapeCql(text)}`
  const url = new URL(SEARCH_URL)
  url.searchParams.set('q', cql)
  url.searchParams.set('Range', `1-${limit}`)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { Authorization: `Bearer ${tokenOutcome.token}` }, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  // EPO OPS responses are XML only — no JSON option exists.
  const exchangeDocs = extractXmlBlocks(result.text, 'exchange-document')
  const documents = exchangeDocs
    .map(parseExchangeDocument)
    .filter(doc => doc.docNumber)
    .map(doc => {
      const publicationNumber = `${doc.country ?? ''}${doc.docNumber}${doc.kind ?? ''}`
      const canonicalUrl = `https://worldwide.espacenet.com/patent/search?q=pn%3D${encodeURIComponent(publicationNumber)}`
      return makeDocument({
        id: `epo_ops:${publicationNumber}`,
        provider: PROVIDER,
        providerRecordId: publicationNumber,
        title: doc.title ?? publicationNumber,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'European Patent Office (OPS)',
        contentType: 'patent_record',
        authors: [],
        organization: null,
        publishedAt: doc.date ?? null,
        updatedAt: null,
        geography: doc.country ?? null,
        language: null,
        identifiers: { publication_number: publicationNumber },
        subjects: [],
        license: null,
        accessStatus: 'unknown',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'EPO_OPS_CONSUMER_KEY / EPO_OPS_CONSUMER_SECRET are not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'auth_error') throw new Error(`EPO OPS OAuth token request failed${outcome.status ? ` with HTTP ${outcome.status}` : ''}`)
      throw new Error(`EPO OPS search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'EPO_OPS_CONSUMER_KEY / EPO_OPS_CONSUMER_SECRET missing', durationMs: null }
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

export const epoOpsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
