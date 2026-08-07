import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'crossref' as const

type CrossrefWork = {
  DOI: string
  title?: string[]
  author?: { given?: string; family?: string }[]
  'container-title'?: string[]
  URL?: string
  license?: { URL?: string }[]
  'published-print'?: { 'date-parts'?: number[][] }
  'published-online'?: { 'date-parts'?: number[][] }
  publisher?: string
}

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('CROSSREF_API_BASE_URL', descriptor)) || 'https://api.crossref.org'
}

function userAgent(): string {
  const base = process.env.CROSSREF_USER_AGENT_BASE?.trim() || 'WarRoomResearchEngine/1.0'
  const mailto = process.env.CROSSREF_MAILTO?.trim()
  return mailto ? `${base} (mailto:${mailto})` : base
}

function datePartsToIso(dateParts?: number[][]): string | null {
  const parts = dateParts?.[0]
  if (!parts || parts.length === 0) return null
  const [year, month = 1, day = 1] = parts
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const cacheKey = `crossref:search:${query.text}:${query.maxResults ?? 10}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const rows = Math.max(1, Math.min(query.maxResults ?? 10, 20))
  const url = new URL(`${baseUrl()}/works`)
  url.searchParams.set('query', query.text)
  url.searchParams.set('rows', String(rows))
  url.searchParams.set('select', 'DOI,title,author,container-title,URL,license,published-print,published-online,publisher')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'User-Agent': userAgent() }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, status: result.status }

  const data = safeJsonParse<{ message?: { items?: CrossrefWork[] } }>(result.text)
  const items = data?.message?.items ?? []
  const documents = items
    .filter(item => item.DOI)
    .map(item => {
      const publishedAt = datePartsToIso(item['published-print']?.['date-parts']) ?? datePartsToIso(item['published-online']?.['date-parts'])
      return makeDocument({
        id: `crossref:${item.DOI}`,
        provider: PROVIDER,
        providerRecordId: item.DOI,
        title: item.title?.[0] ?? item.DOI,
        summary: null,
        contentSnippet: null,
        canonicalUrl: `https://doi.org/${encodeURIComponent(item.DOI)}`,
        sourceUrl: item.URL ?? null,
        sourceName: item['container-title']?.[0] ?? 'Crossref',
        contentType: 'scholarly_work',
        authors: (item.author ?? []).map(author => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
        organization: item.publisher ?? null,
        publishedAt,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { doi: item.DOI },
        subjects: [],
        license: item.license?.[0]?.URL ?? null,
        accessStatus: 'unknown',
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
      if (!outcome.ok) throw new Error(`Crossref search failed with HTTP ${outcome.status}`)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/works?rows=1&query=test`, { headers: { 'User-Agent': userAgent() }, timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'works endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const crossrefAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
