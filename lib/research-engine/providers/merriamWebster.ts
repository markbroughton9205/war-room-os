import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'merriam_webster' as const
const BASE_URL = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json'

// Auth mechanism (key query param, real plain-text "Key is required."
// response with no key) confirmed live. Free self-service key via
// dictionaryapi.com account registration (non-commercial tier, ~1000
// queries/day). Response body shape for a valid key not independently
// re-verified live (no key available this build).
type Definition = { shortdef?: string[] }

function apiKey(): string {
  return process.env.MERRIAM_WEBSTER_API_KEY?.trim() ?? ''
}

async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const word = query.text.trim().toLowerCase().slice(0, 100)
  if (!word) throw new Error('Query must be a word to define.')
  const cacheKey = `merriam_webster:${word}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/${encodeURIComponent(word)}`)
  url.searchParams.set('key', apiKey())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Definition[]>(result.text)
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const canonicalUrl = `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`
  const documents = [makeDocument({
    id: `merriam_webster:${word}`,
    provider: PROVIDER,
    providerRecordId: word,
    title: word,
    summary: data[0]?.shortdef?.join('; ') ?? null,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'Merriam-Webster',
    contentType: 'dictionary_entry',
    authors: [],
    organization: 'Merriam-Webster',
    publishedAt: null,
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { merriam_webster_word: word },
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
    return notConfiguredResponse(PROVIDER, 'MERRIAM_WEBSTER_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Merriam-Webster lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'MERRIAM_WEBSTER_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/test?key=${apiKey()}`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'collegiate reference endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const merriamWebsterAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
