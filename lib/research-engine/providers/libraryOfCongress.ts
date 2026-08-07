import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, resolveBaseUrl } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'library_of_congress' as const

type LocResult = {
  id?: string
  url?: string
  title?: string
  description?: string[] | string
  date?: string
  digitized?: boolean
  access_restricted?: boolean
  rights_advisory?: string[]
  access_advisory?: string[]
  online_format?: string[]
  original_format?: string[]
  contributor?: string[]
  resources?: { url?: string }[]
}
type LocSearchResponse = { results?: LocResult[] }

function baseUrl(): string {
  const descriptor = providerEnvDescriptor(PROVIDER)
  return (descriptor && resolveBaseUrl('LIBRARY_OF_CONGRESS_API_BASE_URL', descriptor)) || 'https://www.loc.gov'
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const count = Math.max(1, Math.min(query.maxResults ?? 10, 25))
  const cacheKey = `library_of_congress:search:${query.text}:${count}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${baseUrl()}/search/`)
  url.searchParams.set('q', query.text)
  url.searchParams.set('fo', 'json')
  url.searchParams.set('c', String(count))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, status: result.status }

  const data = safeJsonParse<LocSearchResponse>(result.text)
  const results = data?.results ?? []
  const documents = results
    .filter(item => item.title && item.url)
    .map(item => {
      // digitized=true does not guarantee resources[] is populated — check explicitly rather than assuming.
      const hasResource = Boolean(item.digitized && item.resources && item.resources.length > 0)
      const description = Array.isArray(item.description) ? item.description.join(' ') : item.description ?? null
      return makeDocument({
        id: `library_of_congress:${item.id ?? item.url}`,
        provider: PROVIDER,
        providerRecordId: item.id ?? null,
        title: item.title as string,
        summary: description,
        contentSnippet: description,
        canonicalUrl: item.url as string,
        sourceUrl: item.url as string,
        sourceName: 'Library of Congress',
        contentType: (item.original_format ?? [])[0] ?? 'archival_item',
        authors: item.contributor ?? [],
        organization: 'Library of Congress',
        publishedAt: item.date ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: {},
        subjects: item.online_format ?? [],
        license: null,
        accessStatus: item.access_restricted ? 'restricted' : 'unknown',
        warnings: [
          ...(item.access_restricted ? ['Access restricted per Library of Congress metadata.'] : []),
          ...(item.rights_advisory?.length ? [`Rights advisory: ${item.rights_advisory.join('; ')}`] : []),
          ...(item.access_advisory?.length ? [`Access advisory: ${item.access_advisory.join('; ')}`] : []),
          ...(item.digitized && !hasResource ? ['Marked digitized but no downloadable resource is listed in this response.'] : []),
        ],
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
      if (!outcome.ok) throw new Error(`Library of Congress search failed with HTTP ${outcome.status}`)
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${baseUrl()}/search/?q=test&fo=json&c=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const libraryOfCongressAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
