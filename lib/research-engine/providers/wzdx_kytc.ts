import 'server-only'

/**
 * Kentucky Transportation Cabinet WZDx work-zone feed — God's Eye Phase 3. Real endpoint
 * confirmed live this build:
 * GET https://storage.googleapis.com/kytc-its-2020-openrecords/public/feeds/WZDx/kytc_wzdx_v4.1.geojson
 * — real HTTP 200 (application/json, ~470 KB), WZDx v4.1, real per-feature LineString geometry
 * and real statewide bbox. Zero-auth, keyless (a static public GeoJSON file on KYTC's open
 * records bucket — the registry documents a 30-minute update cadence).
 * Listed in the official USDOT WZDx feed registry (data.transportation.gov dataset 69qe-yiui).
 * Parsing lives in wzdx_shared.ts — this file is the thin per-feed wrapper.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { searchWzdxFeed, type WzdxFeedDefinition } from '@/lib/research-engine/providers/wzdx_shared'

const FEED: WzdxFeedDefinition = {
  provider: 'wzdx_kytc',
  feedUrl: 'https://storage.googleapis.com/kytc-its-2020-openrecords/public/feeds/WZDx/kytc_wzdx_v4.1.geojson',
  sourceName: 'KYTC WZDx Work Zone Feed',
  organization: 'Kentucky Transportation Cabinet',
  license: 'KYTC open records public feed (USDOT WZDx feed registry listing)',
  exampleBbox: '38.0,-85.9,38.4,-85.4',
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(FEED.provider, async () => {
      const outcome = await searchWzdxFeed(FEED, query.text, query.maxResults)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`KYTC WZDx feed request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(FEED.provider, { provider: FEED.provider, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(FEED.provider, FEED.feedUrl, { timeoutMs: 15_000, maxResponseBytes: 1024 })
    return { provider: FEED.provider, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'kytc_wzdx_v4.1.geojson endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: FEED.provider, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wzdxKytcAdapter: ResearchProviderAdapter = { id: FEED.provider, run, healthCheck }
