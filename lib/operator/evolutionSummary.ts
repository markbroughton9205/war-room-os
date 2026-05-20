import type { EvolutionOperatorSummary, RepairIntelligenceSnapshot } from '@/lib/evolution/types'
import { readinessLabel } from '@/lib/evolution/readinessScore'

export function buildEvolutionOperatorSummary(snapshot: RepairIntelligenceSnapshot): EvolutionOperatorSummary {
  const blockers = snapshot.missingConfiguration.filter(item => item.severity === 'BLOCKER').length
    + snapshot.repairQueue.filter(item => item.severity === 'BLOCKER').length
  const next = snapshot.nextRequiredAction

  return {
    overallReadiness: snapshot.scores.overall,
    readinessLabel: readinessLabel(snapshot.scores.overall),
    blockerCount: blockers,
    missingConfigCount: snapshot.missingConfiguration.length,
    nextActionTitle: next?.title ?? 'No urgent repair action',
    nextActionDetail: next?.evidence[0] ?? 'Source-backed checks show no BLOCKER items.',
  }
}
