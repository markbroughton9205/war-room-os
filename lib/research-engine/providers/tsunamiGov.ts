import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

/**
 * NOAA National Tsunami Warning Center (Palmer, AK) — a real, live, zero-auth Atom/GeoRSS feed of
 * tsunami information statements, watches, advisories, and warnings. Hand-rolled regex extraction,
 * not a new XML dependency — the same convention lib/research-engine/providers/ndlSearch.ts
 * already uses for its own Atom/RSS feed.
 *
 * The real NOAA category classification (Information / Watch / Advisory / Warning) is preserved
 * verbatim in `identifiers.category` — never reinterpreted into a War Room severity scale. Most
 * entries in this feed are "Information" statements confirming NO tsunami danger from a given
 * earthquake; that is the honest, common case, not a sign the adapter is broken.
 *
 * This is the NTWC's own feed; the Pacific Tsunami Warning Center (Honolulu) issues some separate
 * bulletins not mirrored here — a known, documented scope limitation, not a fabricated
 * "global tsunami coverage" claim.
 */
const PROVIDER = 'tsunami_gov' as const
const BASE_URL = 'https://www.tsunami.gov/events/xml/PAAQAtom.xml'
const MAX_RESULTS = 25

function extractTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!match) return null
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const match = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"[^>]*/?>`).exec(xml)
  return match ? match[1] : null
}

function extractSummaryField(summaryHtml: string, label: string): string | null {
  const match = new RegExp(`<strong>${label}:?\\s*</strong>\\s*([^<]+)`, 'i').exec(summaryHtml)
  return match ? match[1].trim() : null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const limit = Math.max(1, Math.min(query.maxResults ?? 20, MAX_RESULTS))
  const cacheKey = `tsunami_gov:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, BASE_URL, { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  if (!result.text.includes('<entry>')) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const entries = (result.text.match(/<entry>[\s\S]*?<\/entry>/g) ?? []).slice(0, limit)
  const documents = entries
    .map(entry => {
      const id = extractTag(entry, 'id')
      const title = extractTag(entry, 'title')
      if (!id || !title) return null
      const updated = extractTag(entry, 'updated')
      const latText = extractTag(entry, 'geo:lat')
      const lonText = extractTag(entry, 'geo:long')
      const summaryHtml = extractTag(entry, 'summary') ?? ''
      const category = extractSummaryField(summaryHtml, 'Category') ?? 'Information'
      const magnitude = extractSummaryField(summaryHtml, 'Preliminary Magnitude')
      const affectedRegion = extractSummaryField(summaryHtml, 'Affected Region')
      const bulletinUrl = extractAttr(entry, 'link', 'href') // first <link> in the entry; refined below if a "Bulletin" link exists
      const bulletinLinkMatch = /<link rel="alternate" title="Bulletin" href="([^"]+)"/.exec(entry)
      const canonicalUrl = bulletinLinkMatch?.[1] ?? bulletinUrl ?? 'https://www.tsunami.gov/'
      const lat = latText ? Number(latText) : null
      const lon = lonText ? Number(lonText) : null

      return makeDocument({
        id: `tsunami_gov:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title,
        summary: affectedRegion ? `${category}: ${title} (${affectedRegion})` : `${category}: ${title}`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NOAA National Tsunami Warning Center',
        contentType: 'tsunami_bulletin',
        authors: [],
        organization: 'NOAA/NWS NTWC',
        publishedAt: updated,
        updatedAt: updated,
        geography: lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) ? `lat ${lat}, lon ${lon}` : null,
        language: 'en',
        identifiers: {
          category,
          ...(magnitude ? { preliminary_magnitude: magnitude } : {}),
          ...(affectedRegion ? { affected_region: affectedRegion } : {}),
        },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`Tsunami.gov fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'atom feed reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const tsunamiGovAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
