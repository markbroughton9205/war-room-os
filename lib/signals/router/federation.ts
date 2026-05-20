import 'server-only'

import type { SignalRawItem } from '../model'
import { runFirecrawlOrDirectSources, runNewsProviders } from '../providers'
import { getAllProviderHealth } from './healthMemory'
import { executeFailoverChain } from './failover'
import { buildConfiguredMap } from './selection'
import {
  FAILOVER_CHAIN,
  type FederationContext,
  type FederationResult,
  type SignalFederationStatus,
  type SignalSourceId,
} from './types'

function dedupeItems(items: SignalRawItem[]): SignalRawItem[] {
  const seen = new Set<string>()
  const out: SignalRawItem[] = []
  for (const item of items) {
    const key = `${item.url}::${item.title}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function applyConfidenceMultiplier(items: SignalRawItem[], multiplier: number): SignalRawItem[] {
  if (multiplier >= 0.999) return items
  return items.map(item => ({
    ...item,
    rawScore: typeof item.rawScore === 'number'
      ? Math.max(0, item.rawScore * multiplier)
      : multiplier * 0.7,
    metadata: {
      ...item.metadata,
      federationConfidenceMultiplier: multiplier,
    },
  }))
}

function buildQuotaUsage(): SignalFederationStatus['quotaUsage'] {
  const configured = buildConfiguredMap()
  return {
    tavily: { configured: configured.tavily ?? false, estimatedRemaining: null, usedThisSession: 0 },
    brave: { configured: configured.brave ?? false, estimatedRemaining: null, usedThisSession: 0 },
    firecrawl: { configured: configured.firecrawl ?? false, estimatedRemaining: null, usedThisSession: 0 },
    rss: { configured: true, estimatedRemaining: null, usedThisSession: 0 },
  }
}

function degradedSources(attempts: FederationResult['status']['attempts']): SignalSourceId[] {
  return attempts
    .filter(a => a.configured && !a.ok)
    .map(a => a.sourceId)
}

export async function runFederatedSignalIngestion(ctx: FederationContext): Promise<FederationResult> {
  const { items: primaryItems, routing, attempts } = await executeFailoverChain(ctx)
  const adjustedPrimary = applyConfidenceMultiplier(primaryItems, routing.confidenceMultiplier)

  const [news, extracted] = await Promise.allSettled([
    runNewsProviders(ctx.capturedAt),
    runFirecrawlOrDirectSources(ctx.sources.filter(s => s.url), ctx.capturedAt),
  ])

  const supplementary: FederationResult['supplementary'] = {}
  const mergeItems: SignalRawItem[] = [...adjustedPrimary]

  if (news.status === 'fulfilled') {
    supplementary.newsapi = news.value
    mergeItems.push(...news.value.items)
  }
  if (extracted.status === 'fulfilled') {
    supplementary.firecrawl = extracted.value
    mergeItems.push(...extracted.value.items)
  }

  const items = dedupeItems(mergeItems)
  const historicalCount = items.filter(i => i.provider === 'historical' || i.metadata?.evidenceLabel === 'HISTORICAL_PATTERN_BASED').length
  const liveCount = items.filter(i => i.metadata?.freshnessStatus === 'LIVE' || i.provider === 'tavily' || i.provider === 'brave').length

  const status: SignalFederationStatus = {
    generatedAt: new Date().toISOString(),
    activeSource: routing.activeSource,
    degradedSources: degradedSources(attempts),
    fallbackChain: [...FAILOVER_CHAIN],
    fallbackActivated: routing.fallbackActivated,
    fallbackReason: routing.fallbackReason,
    confidenceImpact: routing.fallbackActivated
      ? `Confidence scaled by ${Math.round(routing.confidenceMultiplier * 100)}% (${routing.activeSource})`
      : 'No confidence penalty — primary source succeeded',
    mode: routing.mode,
    operatorGuidance: routing.operatorGuidance,
    routing,
    providerHealth: getAllProviderHealth(),
    quotaUsage: buildQuotaUsage(),
    freshness: {
      liveCount,
      recentCount: Math.max(0, items.length - liveCount - historicalCount),
      historicalCount,
      oldestAgeDays: null,
    },
    attempts,
  }

  return {
    items,
    routing,
    status,
    diagnostics: {
      federation: status,
      primaryItemCount: primaryItems.length,
      mergedItemCount: items.length,
      supplementaryConfigured: {
        news: news.status === 'fulfilled',
        extract: extracted.status === 'fulfilled',
      },
    },
    supplementary,
  }
}

export function getFederationStatusSnapshot(): SignalFederationStatus {
  const configured = buildConfiguredMap()
  const providerHealth = getAllProviderHealth()
  const degraded: SignalSourceId[] = FAILOVER_CHAIN.filter(id => !configured[id] || providerHealth[id]?.consecutiveFailures >= 2)

  return {
    generatedAt: new Date().toISOString(),
    activeSource: configured.tavily ? 'tavily' : configured.rss ? 'rss' : configured.brave ? 'brave' : 'historical',
    degradedSources: degraded,
    fallbackChain: [...FAILOVER_CHAIN],
    fallbackActivated: !configured.tavily,
    fallbackReason: !configured.tavily ? 'TAVILY_API_KEY not configured' : null,
    confidenceImpact: !configured.tavily ? 'Awaiting scan — Tavily offline increases fallback likelihood' : 'Standby until next scan',
    mode: configured.tavily ? 'live' : 'degraded',
    operatorGuidance: configured.tavily
      ? 'Federation ready. Next bounded scan will route through health-weighted providers.'
      : 'Tavily unavailable — scans will auto-fallback RSS → Brave → Firecrawl → cache → historical.',
    routing: {
      activeSource: configured.tavily ? 'tavily' : 'rss',
      attemptedChain: [],
      fallbackActivated: !configured.tavily,
      fallbackReason: !configured.tavily ? 'Primary search provider not configured' : null,
      confidenceMultiplier: configured.tavily ? 1 : 0.88,
      mode: configured.tavily ? 'live' : 'degraded',
      operatorGuidance: 'Status snapshot only — run scan for live routing evidence.',
      selectedAt: new Date().toISOString(),
    },
    providerHealth,
    quotaUsage: buildQuotaUsage(),
    freshness: { liveCount: 0, recentCount: 0, historicalCount: 0, oldestAgeDays: null },
    attempts: [],
  }
}
