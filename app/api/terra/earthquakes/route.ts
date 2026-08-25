import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { executeResearch } from '@/lib/research-engine/core/execute'
import { normalizeUsgsEarthquakeFeed } from '@/lib/terra/normalizeUsgsEarthquakeFeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Terra's earthquake layer data route — Phase 1's single wired source.
 *
 * This does not call USGS directly and does not implement a second USGS client: it calls
 * executeResearch(), the exact same Research Engine entry point app/api/research/search/route.ts
 * uses, scoped to the one provider (usgs_earthquake_feed) this phase wires. The Research Engine's
 * own provider-gate, retry/backoff, host allowlist, and 60s live-feed cache (see
 * lib/research-engine/cache/ttlCache.ts CACHE_TTL.liveFeed) all apply exactly as they do for
 * every other Research Engine caller — nothing here bypasses or duplicates that path.
 *
 * Query text is left empty, which the adapter's own parseFeedSelection() resolves to its
 * documented conservative default (magnitude 4.5, past day) — a deliberate, already-existing
 * provider decision, not a new one made here.
 */
export async function GET() {
  const commander = await requireCommanderSession('Terra earthquake layer')
  if (!commander.ok) return commander.response

  const startedAt = new Date().toISOString()
  const { summary } = await executeResearch({
    text: '',
    intent: null,
    providers: ['usgs_earthquake_feed'],
    maxResults: 100,
    dateFrom: null,
    dateTo: null,
    requireCurrent: true,
    requestedBy: commander.userId,
    requestedAt: startedAt,
  })

  const providerResponse = summary.providerResponses.find(response => response.provider === 'usgs_earthquake_feed') ?? null

  if (!providerResponse || !providerResponse.ok) {
    return NextResponse.json({
      tool: 'terra-earthquakes',
      status: 'error',
      features: [],
      skippedCount: 0,
      fetchedAt: summary.completedAt,
      fromCache: false,
      error: providerResponse?.error ?? { provider: 'usgs_earthquake_feed', category: 'unknown', message: 'usgs_earthquake_feed did not respond.', httpStatus: null },
    })
  }

  const { features, skippedCount } = normalizeUsgsEarthquakeFeed(providerResponse.geoFeatures, providerResponse.documents)

  return NextResponse.json({
    tool: 'terra-earthquakes',
    status: features.length === 0 ? 'empty' : 'success',
    features,
    skippedCount,
    fetchedAt: summary.completedAt,
    fromCache: providerResponse.fromCache,
    error: null,
  })
}
