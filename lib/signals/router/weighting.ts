import { getProviderHealth, isProviderHealthy } from './healthMemory'
import type { ProviderHealthMemory, SignalSourceId } from './types'

export type ProviderWeightInput = {
  sourceId: SignalSourceId
  configured: boolean
  estimatedCostPerQuery: number
  reliabilityPrior: number
  freshnessPrior: number
  credibilityPrior: number
}

const DEFAULT_WEIGHTS: Record<SignalSourceId, Omit<ProviderWeightInput, 'sourceId' | 'configured'>> = {
  tavily: { estimatedCostPerQuery: 0.08, reliabilityPrior: 0.88, freshnessPrior: 0.9, credibilityPrior: 0.82 },
  rss: { estimatedCostPerQuery: 0.01, reliabilityPrior: 0.78, freshnessPrior: 0.72, credibilityPrior: 0.7 },
  brave: { estimatedCostPerQuery: 0.05, reliabilityPrior: 0.8, freshnessPrior: 0.85, credibilityPrior: 0.78 },
  firecrawl: { estimatedCostPerQuery: 0.12, reliabilityPrior: 0.76, freshnessPrior: 0.8, credibilityPrior: 0.75 },
  cache: { estimatedCostPerQuery: 0, reliabilityPrior: 0.65, freshnessPrior: 0.45, credibilityPrior: 0.6 },
  historical: { estimatedCostPerQuery: 0, reliabilityPrior: 0.5, freshnessPrior: 0.2, credibilityPrior: 0.42 },
  local_manual: { estimatedCostPerQuery: 0, reliabilityPrior: 0.55, freshnessPrior: 0.3, credibilityPrior: 0.5 },
  newsapi: { estimatedCostPerQuery: 0.04, reliabilityPrior: 0.8, freshnessPrior: 0.82, credibilityPrior: 0.84 },
  guardian: { estimatedCostPerQuery: 0.03, reliabilityPrior: 0.86, freshnessPrior: 0.8, credibilityPrior: 0.9 },
  source_url: { estimatedCostPerQuery: 0.02, reliabilityPrior: 0.7, freshnessPrior: 0.65, credibilityPrior: 0.72 },
}

function latencyScore(health: ProviderHealthMemory): number {
  const ms = health.avgLatencyMs ?? health.lastLatencyMs
  if (ms === null) return 0.7
  if (ms < 1200) return 1
  if (ms < 3000) return 0.85
  if (ms < 8000) return 0.6
  return 0.35
}

function costScore(cost: number): number {
  if (cost <= 0) return 1
  if (cost <= 0.03) return 0.9
  if (cost <= 0.08) return 0.75
  return 0.5
}

export function scoreProvider(input: ProviderWeightInput): number {
  const health = getProviderHealth(input.sourceId, input.configured)
  if (!input.configured) return 0
  if (!isProviderHealthy(input.sourceId, input.configured)) return 0.15

  const reliability = (health.uptimeRatio * 0.55) + (input.reliabilityPrior * 0.45)
  const freshness = input.freshnessPrior * (1 - Math.min(0.4, health.staleDataHits * 0.05))
  const credibility = input.credibilityPrior
  const latency = latencyScore(health)
  const cost = costScore(input.estimatedCostPerQuery)

  return (
    reliability * 0.32
    + freshness * 0.24
    + credibility * 0.2
    + latency * 0.14
    + cost * 0.1
  )
}

export function rankProviders(
  candidates: SignalSourceId[],
  configuredMap: Partial<Record<SignalSourceId, boolean>>,
): SignalSourceId[] {
  return [...candidates].sort((a, b) => {
    const aInput = { sourceId: a, configured: configuredMap[a] ?? false, ...DEFAULT_WEIGHTS[a] }
    const bInput = { sourceId: b, configured: configuredMap[b] ?? false, ...DEFAULT_WEIGHTS[b] }
    return scoreProvider(bInput) - scoreProvider(aInput)
  })
}

export function confidenceMultiplierForSource(sourceId: SignalSourceId, fallbackActivated: boolean): number {
  if (!fallbackActivated) return 1
  switch (sourceId) {
    case 'tavily':
    case 'brave':
    case 'firecrawl':
      return 0.95
    case 'rss':
      return 0.88
    case 'cache':
      return 0.72
    case 'historical':
    case 'local_manual':
      return 0.55
    default:
      return 0.8
  }
}
