import type { ProviderHealthMemory, SignalSourceId } from './types'

const memory = new Map<SignalSourceId, ProviderHealthMemory>()

const MAX_RECENT_FAILURES = 12

function baseHealth(sourceId: SignalSourceId, configured: boolean): ProviderHealthMemory {
  return {
    sourceId,
    uptimeRatio: configured ? 0.85 : 0,
    recentFailures: 0,
    consecutiveFailures: configured ? 0 : 1,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastLatencyMs: null,
    avgLatencyMs: null,
    staleDataHits: 0,
    lastError: null,
    configured,
  }
}

export function getProviderHealth(sourceId: SignalSourceId, configured = true): ProviderHealthMemory {
  const existing = memory.get(sourceId)
  if (existing) return { ...existing }
  return baseHealth(sourceId, configured)
}

export function getAllProviderHealth(): Record<SignalSourceId, ProviderHealthMemory> {
  const ids: SignalSourceId[] = [
    'tavily', 'rss', 'brave', 'firecrawl', 'cache', 'historical', 'local_manual',
  ]
  return Object.fromEntries(ids.map(id => [id, getProviderHealth(id)])) as Record<SignalSourceId, ProviderHealthMemory>
}

export function recordProviderSuccess(sourceId: SignalSourceId, latencyMs: number, configured = true) {
  const prev = getProviderHealth(sourceId, configured)
  const samples = prev.avgLatencyMs === null ? latencyMs : Math.round((prev.avgLatencyMs * 0.7) + (latencyMs * 0.3))
  const successes = Math.min(100, Math.round(prev.uptimeRatio * 100) + 1)
  const total = successes + prev.recentFailures
  memory.set(sourceId, {
    ...prev,
    configured,
    uptimeRatio: total > 0 ? successes / total : 0.9,
    recentFailures: Math.max(0, prev.recentFailures - 1),
    consecutiveFailures: 0,
    lastSuccessAt: new Date().toISOString(),
    lastLatencyMs: latencyMs,
    avgLatencyMs: samples,
    lastError: null,
  })
}

export function recordProviderFailure(
  sourceId: SignalSourceId,
  error: string,
  configured = true,
  options?: { staleData?: boolean },
) {
  const prev = getProviderHealth(sourceId, configured)
  const failures = Math.min(MAX_RECENT_FAILURES, prev.recentFailures + 1)
  const total = Math.max(1, Math.round(prev.uptimeRatio * 100) + failures)
  memory.set(sourceId, {
    ...prev,
    configured,
    uptimeRatio: Math.max(0.05, (Math.round(prev.uptimeRatio * 100)) / total),
    recentFailures: failures,
    consecutiveFailures: prev.consecutiveFailures + 1,
    lastFailureAt: new Date().toISOString(),
    lastError: error.slice(0, 200),
    staleDataHits: options?.staleData ? prev.staleDataHits + 1 : prev.staleDataHits,
  })
}

export function isProviderHealthy(sourceId: SignalSourceId, configured = true): boolean {
  const health = getProviderHealth(sourceId, configured)
  if (!configured) return false
  if (health.consecutiveFailures >= 3) return false
  if (health.uptimeRatio < 0.35) return false
  return true
}
