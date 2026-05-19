import type { RuntimeGraphSnapshot } from '@/lib/runtime-graph/types'

export type MomentumSnapshot = {
  generatedAt: string
  streaks: number
  completedActions: number
  revenueVelocity: number | null
  unfinishedLoops: number
  abandonedMissions: number
  compoundingSystems: number
  executionConsistency: number
  momentumTrend: 'rising' | 'stable' | 'decaying' | 'unknown'
  warnings: string[]
}

export function deriveMomentumSnapshot(graph: RuntimeGraphSnapshot): MomentumSnapshot {
  const completedActions = graph.nodes.filter(node => node.kind === 'approval' && node.status === 'approved').length
  const unfinishedLoops = graph.derived.unfinishedLoops.length
  const abandonedMissions = graph.missions.filter(mission => mission.status === 'PAUSED' || mission.status === 'BLOCKED').length
  const compoundingSystems = graph.derived.compoundingWins.length
  const missionMomentum = graph.missions.reduce((sum, mission) => sum + mission.momentum_score, 0) / Math.max(1, graph.missions.length)
  const executionConsistency = Math.max(0, Math.min(100, Math.round(missionMomentum + completedActions * 4 + compoundingSystems * 6 - unfinishedLoops * 5)))
  const warnings = [
    ...(graph.derived.overloadRisk >= 70 ? ['Overload risk is elevated. Reduce to one approval-bound action.'] : []),
    ...(graph.derived.focusFragmentation >= 70 ? ['Focus drift is elevated across active missions.'] : []),
    ...(graph.derived.missionDecay >= 65 ? ['Mission decay is rising from blockers and low momentum.'] : []),
  ]

  return {
    generatedAt: graph.generatedAt,
    streaks: Math.max(0, Math.floor(completedActions / 3)),
    completedActions,
    revenueVelocity: null,
    unfinishedLoops,
    abandonedMissions,
    compoundingSystems,
    executionConsistency,
    momentumTrend: graph.derived.momentumTrend,
    warnings,
  }
}
