import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'jpl_horizons' as const
const BASE_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const MAX_SUMMARY_LENGTH = 2000

type HorizonsResponse = { result?: string }

/** Query text is a JPL Horizons body command, e.g. "499" (Mars), "1" (Ceres), "-125544" (ISS). */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const bodyId = query.text.trim().slice(0, 20)
  if (!bodyId) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `jpl_horizons:${bodyId}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('format', 'json')
  url.searchParams.set('COMMAND', `'${bodyId}'`)
  url.searchParams.set('OBJ_DATA', "'YES'")
  url.searchParams.set('MAKE_EPHEM', "'NO'")

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<HorizonsResponse>(result.text)
  if (!data || typeof data.result !== 'string') {
    return { ok: false as const, kind: 'malformed' as const, message: 'JPL Horizons response "result" field was missing or not a string.' }
  }

  // The response is a single large preformatted text blob, not structured
  // fields — treated as document content, same convention this codebase
  // uses for medlineplus's unstructured FullSummary field.
  const canonicalUrl = 'https://ssd.jpl.nasa.gov/horizons/app.html#/'
  const nameMatch = /Target body name:\s*(.+?)(?:\s{2,}|\n)/.exec(data.result)
  const title = nameMatch ? nameMatch[1].trim() : `JPL Horizons body ${bodyId}`
  const documents = [makeDocument({
    id: `jpl_horizons:${bodyId}`,
    provider: PROVIDER,
    providerRecordId: bodyId,
    title,
    summary: data.result.slice(0, MAX_SUMMARY_LENGTH),
    contentSnippet: data.result.slice(0, 500),
    canonicalUrl,
    sourceUrl: url.toString(),
    sourceName: 'JPL Horizons',
    contentType: 'solar_system_body_data',
    authors: [],
    organization: 'NASA/JPL',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { horizons_command: bodyId },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`JPL Horizons fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?format=json&COMMAND='499'&OBJ_DATA='YES'&MAKE_EPHEM='NO'`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'horizons.api reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const jplHorizonsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
