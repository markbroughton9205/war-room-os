import 'server-only'

/**
 * WSDOT WZDx work-zone feed (Washington State DOT) — God's Eye Phase 3. Real endpoint confirmed
 * live this build: GET https://wzdx.wsdot.wa.gov/api/v4/WorkZoneFeed — real HTTP 200
 * (application/json, ~1.4 MB), WZDx v4.2, real road_event_feed_info.update_date fresh to the
 * minute (update_frequency 60 seconds per the feed's own feed-info). Zero-auth, keyless.
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
  provider: 'wzdx_wsdot',
  feedUrl: 'https://wzdx.wsdot.wa.gov/api/v4/WorkZoneFeed',
  sourceName: 'WSDOT WZDx Work Zone Feed',
  organization: 'Washington State Department of Transportation',
  license: 'WSDOT public data feed (USDOT WZDx feed registry listing)',
  exampleBbox: '47.2,-122.6,47.9,-121.9',
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(FEED.provider, async () => {
      const outcome = await searchWzdxFeed(FEED, query.text, query.maxResults)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`WSDOT WZDx feed request failed with HTTP ${outcome.status}`)
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
    return { provider: FEED.provider, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'WorkZoneFeed endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: FEED.provider, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wzdxWsdotAdapter: ResearchProviderAdapter = { id: FEED.provider, run, healthCheck }
