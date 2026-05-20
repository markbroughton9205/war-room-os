import type { SignalProviderId, SignalRawItem, SignalSourceDefinition } from '../model'
import type { ProviderRunResult } from '../providers'

/** Federated intelligence source identifiers (includes non-DB providers). */
export type SignalSourceId =
  | 'tavily'
  | 'rss'
  | 'brave'
  | 'firecrawl'
  | 'cache'
  | 'historical'
  | 'local_manual'
  | 'newsapi'
  | 'guardian'
  | 'source_url'

export type FederationMode = 'live' | 'degraded' | 'historical'

export type ProviderQuotaSnapshot = {
  configured: boolean
  estimatedRemaining: number | null
  usedThisSession: number
}

export type ProviderHealthMemory = {
  sourceId: SignalSourceId
  uptimeRatio: number
  recentFailures: number
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastLatencyMs: number | null
  avgLatencyMs: number | null
  staleDataHits: number
  lastError: string | null
  configured: boolean
}

export type RoutingDecision = {
  activeSource: SignalSourceId
  attemptedChain: SignalSourceId[]
  fallbackActivated: boolean
  fallbackReason: string | null
  confidenceMultiplier: number
  mode: FederationMode
  operatorGuidance: string
  selectedAt: string
}

export type FederationProviderAttempt = {
  sourceId: SignalSourceId
  ok: boolean
  itemCount: number
  latencyMs: number
  error: string | null
  configured: boolean
}

export type SignalFederationStatus = {
  generatedAt: string
  activeSource: SignalSourceId
  degradedSources: SignalSourceId[]
  fallbackChain: SignalSourceId[]
  fallbackActivated: boolean
  fallbackReason: string | null
  confidenceImpact: string
  mode: FederationMode
  operatorGuidance: string
  routing: RoutingDecision
  providerHealth: Record<SignalSourceId, ProviderHealthMemory>
  quotaUsage: Partial<Record<SignalSourceId, ProviderQuotaSnapshot>>
  freshness: {
    liveCount: number
    recentCount: number
    historicalCount: number
    oldestAgeDays: number | null
  }
  attempts: FederationProviderAttempt[]
}

export type FederationResult = {
  items: SignalRawItem[]
  routing: RoutingDecision
  status: SignalFederationStatus
  diagnostics: Record<string, unknown>
  supplementary: Partial<Record<SignalSourceId, ProviderRunResult>>
}

export type FederationContext = {
  capturedAt: string
  sources: SignalSourceDefinition[]
  /** When true, only walk failover chain for primary ingest (news/rss still merge). */
  primaryFailoverOnly?: boolean
}

export const FAILOVER_CHAIN: SignalSourceId[] = [
  'tavily',
  'rss',
  'brave',
  'firecrawl',
  'cache',
  'historical',
]

export function providerIdFromSource(sourceId: SignalSourceId): SignalProviderId {
  switch (sourceId) {
    case 'brave':
      return 'brave'
    case 'cache':
      return 'cached'
    case 'historical':
    case 'local_manual':
      return 'historical'
    case 'newsapi':
      return 'newsapi'
    case 'guardian':
      return 'guardian'
    case 'source_url':
      return 'source_url'
    default:
      return sourceId as SignalProviderId
  }
}
