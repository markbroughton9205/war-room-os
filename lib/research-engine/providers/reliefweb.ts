import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'reliefweb' as const
const BASE_URL = 'https://api.reliefweb.int/v2'
const MAX_RESULTS = 20

type ReliefWebReport = {
  id?: string
  fields?: {
    title?: string
    url?: string
    date?: { original?: string; created?: string }
    source?: { name?: string }[]
    format?: { name?: string }[]
    primary_country?: { name?: string }
    body?: string
  }
}
type ReliefWebResponse = { data?: ReliefWebReport[] }

function appname(): string {
  return process.env.RELIEFWEB_APPNAME?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `reliefweb:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/reports`)
  url.searchParams.set('appname', appname())
  if (text) url.searchParams.set('query[value]', text)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('fields[include][]', 'title')
  url.searchParams.set('fields[include][]', 'url')
  url.searchParams.set('fields[include][]', 'date')
  url.searchParams.set('fields[include][]', 'source')
  url.searchParams.set('fields[include][]', 'primary_country')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ReliefWebResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'ReliefWeb response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(report => report.id && report.fields?.title)
    .map(report => {
      const id = report.id as string
      const fields = report.fields!
      const canonicalUrl = fields.url ?? `https://reliefweb.int/node/${id}`
      return makeDocument({
        id: `reliefweb:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: fields.title as string,
        summary: fields.body ? fields.body.slice(0, 500) : null,
        contentSnippet: fields.body ? fields.body.slice(0, 500) : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: fields.source?.[0]?.name ?? 'ReliefWeb',
        contentType: 'humanitarian_report',
        authors: [],
        organization: fields.source?.[0]?.name ?? null,
        publishedAt: fields.date?.original ?? fields.date?.created ?? null,
        updatedAt: null,
        geography: fields.primary_country?.name ?? null,
        language: null,
        identifiers: { reliefweb_report_id: id },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'RELIEFWEB_APPNAME is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`ReliefWeb search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'RELIEFWEB_APPNAME missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/reports?appname=${encodeURIComponent(appname())}&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'reports endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const reliefwebAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
