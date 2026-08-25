import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'wikimedia_commons' as const
const BASE_URL = 'https://commons.wikimedia.org/w/api.php'
const MAX_RESULTS = 25

type ExtMetadataField = { value?: string }
type ImageInfo = {
  url?: string
  descriptionurl?: string
  extmetadata?: { ImageDescription?: ExtMetadataField; Artist?: ExtMetadataField; LicenseShortName?: ExtMetadataField; DateTimeOriginal?: ExtMetadataField }
}
type Page = { pageid?: number; title?: string; imageinfo?: ImageInfo[] }
type QueryResponse = { query?: { pages?: Record<string, Page> } }

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `wikimedia_commons:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('action', 'query')
  url.searchParams.set('generator', 'search')
  url.searchParams.set('gsrsearch', text)
  url.searchParams.set('gsrnamespace', '6')
  url.searchParams.set('gsrlimit', String(limit))
  url.searchParams.set('prop', 'imageinfo')
  url.searchParams.set('iiprop', 'url|extmetadata')
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<QueryResponse>(result.text)
  const pages = data?.query?.pages
  if (!pages) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = Object.values(pages)
    .filter(page => typeof page.pageid === 'number')
    .map(page => {
      const id = String(page.pageid)
      const info = page.imageinfo?.[0]
      const meta = info?.extmetadata
      const canonicalUrl = info?.descriptionurl ?? `https://commons.wikimedia.org/?curid=${id}`
      return makeDocument({
        id: `wikimedia_commons:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: page.title ?? `File ${id}`,
        summary: meta?.ImageDescription?.value ? stripHtml(meta.ImageDescription.value) : null,
        contentSnippet: meta?.Artist?.value ? `Artist: ${stripHtml(meta.Artist.value)}` : null,
        canonicalUrl,
        sourceUrl: info?.url ?? canonicalUrl,
        sourceName: 'Wikimedia Commons',
        contentType: 'media_file',
        authors: meta?.Artist?.value ? [stripHtml(meta.Artist.value)] : [],
        organization: null,
        publishedAt: meta?.DateTimeOriginal?.value ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { wikimedia_page_id: id },
        subjects: [],
        license: meta?.LicenseShortName?.value ?? null,
        accessStatus: 'open',
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
      if (outcome.ok) return outcome.response
      throw new Error(`Wikimedia Commons search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?action=query&generator=search&gsrsearch=cat&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wikimediaCommonsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
