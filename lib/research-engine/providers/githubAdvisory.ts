import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'github_advisory' as const
const BASE_URL = 'https://api.github.com/advisories'
const MAX_RESULTS = 20
const KNOWN_ECOSYSTEMS = new Set(['npm', 'pip', 'rubygems', 'maven', 'go', 'composer', 'nuget', 'rust', 'actions', 'swift', 'erlang', 'pub'])
const DEFAULT_ECOSYSTEM = 'npm'

type GhsaAdvisory = {
  ghsa_id?: string
  cve_id?: string | null
  summary?: string
  severity?: string
  cvss?: { score?: number } | null
  epss?: { percentage?: number; percentile?: number } | null
  published_at?: string
  updated_at?: string
  withdrawn_at?: string | null
  html_url?: string
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function resolveEcosystem(text: string): string {
  const trimmed = text.trim().toLowerCase()
  return KNOWN_ECOSYSTEMS.has(trimmed) ? trimmed : DEFAULT_ECOSYSTEM
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const ecosystem = resolveEcosystem(query.text)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `github_advisory:${ecosystem}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('ecosystem', ecosystem)
  url.searchParams.set('per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: authHeaders(), timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GhsaAdvisory[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'GitHub Advisory response was not a JSON array.' }
  }

  const documents = data
    .filter(adv => adv.ghsa_id)
    .map(adv => {
      const id = adv.ghsa_id as string
      const canonicalUrl = adv.html_url ?? `https://github.com/advisories/${id}`
      // Evidence class: curated (reviewed) advisory data is VULNERABILITY_EXISTS;
      // epss.percentage (when present) is a separate PREDICTED_EXPLOITABILITY
      // signal, kept as its own identifier field, never merged into one flag.
      return makeDocument({
        id: `github_advisory:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: adv.summary ?? id,
        summary: adv.summary ?? null,
        contentSnippet: adv.severity ? `Severity: ${adv.severity}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'GitHub Advisory Database',
        contentType: 'vulnerability_record',
        authors: [],
        organization: null,
        publishedAt: adv.published_at ?? null,
        updatedAt: adv.updated_at ?? null,
        geography: null,
        language: 'en',
        identifiers: {
          ghsa_id: id,
          evidence_class: 'VULNERABILITY_EXISTS',
          ...(adv.cve_id ? { cve_id: adv.cve_id } : {}),
          ...(adv.severity ? { severity: adv.severity } : {}),
          ...(typeof adv.epss?.percentage === 'number' ? { epss_percentage: String(adv.epss.percentage), epss_evidence_class: 'PREDICTED_EXPLOITABILITY' } : {}),
          ...(adv.withdrawn_at ? { withdrawn_at: adv.withdrawn_at } : {}),
        },
        subjects: [ecosystem],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`GitHub Advisory search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?ecosystem=npm&per_page=1`, { headers: authHeaders(), timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : result.status === 401 ? 'authentication_failed' : result.status === 403 ? 'rate_limited' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'advisories endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const githubAdvisoryAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
