import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'osv_dev' as const
const BASE_URL = 'https://api.osv.dev/v1'

type OsvVuln = {
  id?: string
  summary?: string
  details?: string
  modified?: string
  published?: string
  aliases?: string[]
  affected?: { package?: { name?: string; ecosystem?: string } }[]
}
type OsvQueryResponse = { vulns?: OsvVuln[] }

/**
 * OSV.dev's query endpoint requires either a commit hash or a
 * package+version/purl — it is not free-text search. A caller query is
 * interpreted as a package name (ecosystem defaults to PyPI, the most common
 * ecosystem, when not specified as "<ecosystem>:<name>" or "<ecosystem>:<name>@<version>").
 */
function parsePackageQuery(text: string): { ecosystem: string; name: string; version: string | null } {
  const versionSplit = text.split('@')
  const withoutVersion = versionSplit[0]
  const version = versionSplit.length > 1 ? versionSplit.slice(1).join('@').trim() : null
  const colonSplit = withoutVersion.split(':')
  if (colonSplit.length > 1) {
    return { ecosystem: colonSplit[0].trim(), name: colonSplit.slice(1).join(':').trim(), version }
  }
  return { ecosystem: 'PyPI', name: withoutVersion.trim(), version }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const { ecosystem, name, version } = parsePackageQuery(query.text.trim().slice(0, 200))
  if (!name) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `osv_dev:query:${ecosystem}:${name}:${version ?? ''}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const body = JSON.stringify(version
    ? { version, package: { name, ecosystem } }
    : { package: { name, ecosystem } })

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeoutMs: 12_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OsvQueryResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'OSV.dev response was not a valid JSON object.' }
  }
  const vulns = Array.isArray(data.vulns) ? data.vulns : []

  const maxResults = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const documents = vulns
    .filter(v => typeof v.id === 'string' && v.id)
    .slice(0, maxResults)
    .map(v => {
      const id = v.id as string
      const canonicalUrl = `https://osv.dev/vulnerability/${id}`
      const cveAlias = (v.aliases ?? []).find(a => a.startsWith('CVE-'))
      return makeDocument({
        id: `osv_dev:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: id,
        summary: v.summary ?? null,
        contentSnippet: v.details ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OSV.dev',
        contentType: 'vulnerability_record',
        authors: [],
        organization: null,
        publishedAt: v.published ?? null,
        updatedAt: v.modified ?? null,
        geography: null,
        language: null,
        // Evidence class: OSV records are ecosystem/community-reported
        // vulnerability data (VULNERABILITY_EXISTS), never treated as a
        // confirmed-exploitation signal — that distinction lives in cisa_kev.
        identifiers: { osv_id: id, evidence_class: 'VULNERABILITY_EXISTS', ...(cveAlias ? { cve_id: cveAlias } : {}) },
        subjects: (v.affected ?? []).map(a => a.package?.name).filter((n): n is string => Boolean(n)),
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
      if (outcome.kind === 'http_error') throw new Error(`OSV.dev query failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { name: 'left-pad', ecosystem: 'npm' } }),
      timeoutMs: 8_000,
    })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'query endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const osvDevAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
