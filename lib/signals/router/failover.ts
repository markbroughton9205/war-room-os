import type { ProviderRunResult } from '../providers'
import { runBraveSignalSearch } from '../providers/brave'
import { runFirecrawlSignalSearch } from '../providers/firecrawlSearch'
import { runRssSources, runTavilySignalSearch } from '../providers'
import { listPersistedSignalSnapshot } from '../persistence'
import type { SignalRawItem } from '../model'
import { recordProviderFailure, recordProviderSuccess } from './healthMemory'
import { confidenceMultiplierForSource } from './weighting'
import {
  type FederationContext,
  FAILOVER_CHAIN,
  type FederationProviderAttempt,
  type RoutingDecision,
  type SignalSourceId,
} from './types'

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/api[_-]?key|secret|token|bearer|unauthorized/i.test(raw)) return 'Provider unavailable (configuration or auth).'
  return raw.slice(0, 180)
}

function isConfigured(sourceId: SignalSourceId): boolean {
  switch (sourceId) {
    case 'tavily':
      return Boolean(process.env.TAVILY_API_KEY?.trim())
    case 'brave':
      return Boolean(process.env.BRAVE_API_KEY?.trim())
    case 'firecrawl':
      return Boolean(process.env.FIRECRAWL_API_KEY?.trim())
    case 'rss':
    case 'cache':
    case 'historical':
      return true
    default:
      return false
  }
}

function historicalItemsFromSnapshot(
  snapshot: Awaited<ReturnType<typeof listPersistedSignalSnapshot>>,
  capturedAt: string,
): SignalRawItem[] {
  return snapshot.results.slice(0, 12).map(row => ({
    provider: 'historical' as const,
    sourceId: `historical-${row.id}`,
    sourceLabel: `Historical: ${row.source}`,
    sourceKind: row.sourceKind,
    title: row.title,
    url: row.url.startsWith('https://') ? row.url : `warroom://signals/historical/${row.id}`,
    summary: row.summary,
    categories: [row.category],
    rawScore: row.scores.highestLeverage / 100,
    capturedAt,
    metadata: {
      evidenceLabel: 'HISTORICAL_PATTERN_BASED',
      historicalFrom: row.provider,
      signalIngestedAt: capturedAt,
      federationMode: 'historical',
    },
  }))
}

async function cachedItems(capturedAt: string): Promise<SignalRawItem[]> {
  const snapshot = await listPersistedSignalSnapshot(24)
  return snapshot.results.slice(0, 10).map(row => ({
    provider: 'cached' as const,
    sourceId: `cache-${row.id}`,
    sourceLabel: `Cached: ${row.source}`,
    sourceKind: row.sourceKind,
    title: row.title,
    url: row.url,
    summary: row.summary,
    categories: [row.category],
    rawScore: row.scores.confidence / 100,
    capturedAt,
    metadata: {
      cachedFrom: row.provider,
      signalIngestedAt: capturedAt,
      federationMode: 'degraded',
    },
  }))
}

async function runSource(
  sourceId: SignalSourceId,
  ctx: FederationContext,
): Promise<ProviderRunResult> {
  switch (sourceId) {
    case 'tavily':
      return runTavilySignalSearch(ctx.capturedAt)
    case 'rss':
      return runRssSources(ctx.sources, ctx.capturedAt)
    case 'brave':
      return runBraveSignalSearch(ctx.capturedAt)
    case 'firecrawl':
      return runFirecrawlSignalSearch(ctx.capturedAt)
    case 'cache': {
      const items = await cachedItems(ctx.capturedAt)
      return { items, diagnostics: { configured: true, resultCount: items.length, mode: 'cache' } }
    }
    case 'historical': {
      const snapshot = await listPersistedSignalSnapshot(40)
      const items = historicalItemsFromSnapshot(snapshot, ctx.capturedAt)
      return { items, diagnostics: { configured: true, resultCount: items.length, mode: 'historical' } }
    }
    default:
      return { items: [], diagnostics: { configured: false, resultCount: 0 } }
  }
}

function operatorGuidanceFor(
  active: SignalSourceId,
  fallbackActivated: boolean,
  fallbackReason: string | null,
  multiplier: number,
): string {
  const impact = multiplier < 1
    ? ` Confidence reduced to ~${Math.round(multiplier * 100)}% because fallback sourcing was used.`
    : ''
  if (!fallbackActivated) {
    return `Primary live source: ${active}. Results are source-backed from the healthiest configured provider.${impact}`
  }
  return `Fallback active (${fallbackReason ?? 'upstream unavailable'}). Showing ${active} results — verify before operator action.${impact}`
}

export async function executeFailoverChain(ctx: FederationContext): Promise<{
  items: SignalRawItem[]
  routing: RoutingDecision
  attempts: FederationProviderAttempt[]
}> {
  const chain = FAILOVER_CHAIN
  const attempts: FederationProviderAttempt[] = []
  let activeSource: SignalSourceId = 'historical'
  let items: SignalRawItem[] = []
  let fallbackActivated = false
  let fallbackReason: string | null = null
  const primaryPreferred = chain[0]

  for (const sourceId of chain) {
    const configured = isConfigured(sourceId)
    const started = Date.now()
    try {
      const result = await runSource(sourceId, ctx)
      const latencyMs = Date.now() - started
      const count = result.items.length
      const diagConfigured = (result.diagnostics.configured as boolean | undefined) ?? configured

      attempts.push({
        sourceId,
        ok: count > 0,
        itemCount: count,
        latencyMs,
        error: count > 0 ? null : 'No items returned',
        configured: diagConfigured,
      })

      if (count > 0) {
        recordProviderSuccess(sourceId, latencyMs, diagConfigured)
        activeSource = sourceId
        items = result.items.map(item => ({
          ...item,
          metadata: {
            ...item.metadata,
            federationSource: sourceId,
            federationActive: true,
          },
        }))
        if (sourceId !== primaryPreferred) {
          fallbackActivated = true
          fallbackReason = `${primaryPreferred} unavailable or empty; escalated to ${sourceId}`
        }
        break
      }

      recordProviderFailure(sourceId, 'No items returned', diagConfigured)
    } catch (error) {
      const latencyMs = Date.now() - started
      const message = sanitizeError(error)
      recordProviderFailure(sourceId, message, configured)
      attempts.push({
        sourceId,
        ok: false,
        itemCount: 0,
        latencyMs,
        error: message,
        configured,
      })
    }
  }

  if (!items.length) {
    activeSource = 'historical'
    fallbackActivated = true
    fallbackReason = 'All federation providers exhausted; using historical pattern baseline'
    const snapshot = await listPersistedSignalSnapshot(40)
    items = historicalItemsFromSnapshot(snapshot, ctx.capturedAt)
    if (!items.length) {
      items = [{
        provider: 'historical',
        sourceId: 'historical-baseline',
        sourceLabel: 'War Room historical baseline',
        sourceKind: 'manual_registry',
        title: 'Operator review: configure cloud signal providers or run RSS feeds',
        url: 'warroom://signals/historical/baseline',
        summary: 'Degraded mode — no live or cached signals. Historical pattern guidance only; approval required before action.',
        categories: ['SMB_automation'],
        rawScore: 0.35,
        capturedAt: ctx.capturedAt,
        metadata: {
          evidenceLabel: 'HISTORICAL_PATTERN_BASED',
          federationMode: 'historical',
          signalIngestedAt: ctx.capturedAt,
        },
      }]
    }
  }

  const confidenceMultiplier = confidenceMultiplierForSource(activeSource, fallbackActivated)
  const mode = activeSource === 'historical' || activeSource === 'cache'
    ? (activeSource === 'historical' ? 'historical' : 'degraded')
    : fallbackActivated ? 'degraded' : 'live'

  const routing: RoutingDecision = {
    activeSource,
    attemptedChain: attempts.map(a => a.sourceId),
    fallbackActivated,
    fallbackReason,
    confidenceMultiplier,
    mode,
    operatorGuidance: operatorGuidanceFor(activeSource, fallbackActivated, fallbackReason, confidenceMultiplier),
    selectedAt: new Date().toISOString(),
  }

  return { items, routing, attempts }
}
