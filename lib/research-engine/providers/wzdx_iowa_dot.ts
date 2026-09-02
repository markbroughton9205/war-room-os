import 'server-only'

/**
 * Iowa DOT WZDx work-zone feed — God's Eye Phase 3. Real endpoint confirmed live this build:
 * GET https://iowa-atms.cloud-q-free.com/api/rest/dataprism/wzdx/wzdxfeed — real HTTP 200
 * (application/json, ~1.5 MB), WZDx v4.0, publisher "Iowa DOT", real update_date fresh to the
 * minute (the registry documents a 1-minute update cadence). Zero-auth, keyless.
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
  provider: 'wzdx_iowa_dot',
  feedUrl: 'https://iowa-atms.cloud-q-free.com/api/rest/dataprism/wzdx/wzdxfeed',
  sourceName: 'Iowa DOT WZDx Work Zone Feed',
  organization: 'Iowa Department of Transportation',
  license: 'Iowa DOT public data feed (USDOT WZDx feed registry listing)',
  exampleBbox: '41.4,-93.9,41.8,-93.4',
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(FEED.provider, async () => {
      const outcome = await searchWzdxFeed(FEED, query.text, query.maxResults)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Iowa DOT WZDx feed request failed with HTTP ${outcome.status}`)
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
    return { provider: FEED.provider, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'wzdxfeed endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: FEED.provider, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const wzdxIowaDotAdapter: ResearchProviderAdapter = { id: FEED.provider, run, healthCheck }
