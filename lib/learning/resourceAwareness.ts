import { getBackgroundWorkerPlans } from './backgroundWorkerCoordinator'
import { getProviderScorecards } from './providerPerformanceTracker'

export type ResourceAwarenessSnapshot = {
  apiProviderUsage: Array<{ provider: string; usageBand: 'low' | 'medium' | 'high'; watch: string }>
  queuePressure: 'low' | 'medium' | 'high'
  memoryGrowth: 'stable' | 'watch' | 'critical'
  workerHealth: 'ready' | 'watch' | 'paused'
  sourceHealth: 'fresh' | 'mixed' | 'stale'
  runtimeLatency: 'normal' | 'watch' | 'high'
  scalingBottlenecks: string[]
  retrievalSuccess: number
  engineeringQueueLoad: 'low' | 'medium' | 'high'
}

export function getResourceAwarenessSnapshot(): ResourceAwarenessSnapshot {
  const providers = getProviderScorecards()
  const workers = getBackgroundWorkerPlans()
  const workerHealth = workers.some(worker => worker.health === 'paused')
    ? 'paused'
    : workers.some(worker => worker.health === 'watch') ? 'watch' : 'ready'

  return {
    apiProviderUsage: providers.slice(0, 6).map(provider => ({
      provider: provider.provider,
      usageBand: provider.sampleSize > 2 ? 'high' : provider.sampleSize > 0 ? 'medium' : 'low',
      watch: provider.watchItems[0] ?? 'No watch item recorded',
    })),
    queuePressure: 'medium',
    memoryGrowth: 'stable',
    workerHealth,
    sourceHealth: 'mixed',
    runtimeLatency: 'normal',
    scalingBottlenecks: ['Validation duration', 'Source freshness checks', 'Commander approval wait'],
    retrievalSuccess: 0.86,
    engineeringQueueLoad: 'medium',
  }
}
