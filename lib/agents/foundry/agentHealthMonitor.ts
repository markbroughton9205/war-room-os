import type { DurableWorker, FoundryAgent } from './agentBlueprints'
import { rankAgentReliability } from './agentPerformanceTracker'

export type AgentEcosystemHealth = {
  state: 'healthy' | 'watch' | 'degraded' | 'awaiting_data'
  workerHealth: {
    total: number
    ready: number
    paused: number
    degraded: number
  }
  warnings: string[]
}

export function monitorAgentEcosystem(agents: FoundryAgent[], workers: DurableWorker[], persistentRows: number | null): AgentEcosystemHealth {
  const scorecards = rankAgentReliability(agents)
  const warnings = [
    ...scorecards.filter(card => card.warning !== 'none').map(card => `${card.name}: ${card.warning}`),
    ...workers.filter(worker => worker.queueDepth > 5).map(worker => `${worker.name}: queue pressure`),
    ...workers.filter(worker => worker.state === 'degraded').map(worker => `${worker.name}: degraded`),
  ]
  const rowCount = persistentRows ?? 0
  return {
    state: rowCount === 0
      ? 'awaiting_data'
      : warnings.some(warning => warning.includes('degrade'))
        ? 'degraded'
        : warnings.length
          ? 'watch'
          : 'healthy',
    workerHealth: {
      total: workers.length,
      ready: workers.filter(worker => worker.state === 'ready').length,
      paused: workers.filter(worker => worker.state === 'paused').length,
      degraded: workers.filter(worker => worker.state === 'degraded').length,
    },
    warnings,
  }
}
