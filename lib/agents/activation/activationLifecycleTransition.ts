import type { ActivationAgentCandidate, ActivationStage } from './agentActivationWorkflow'
import type { ActivationApprovalDecision } from './activationApprovalEngine'
import type { ActivationReadinessState } from './activationReadinessEvaluator'

export type ActivationLifecycleEvent = {
  agentId: string
  from: ActivationStage
  to: ActivationStage
  allowed: boolean
  requiresAudit: true
  requiresDoctrineValidation: true
  requiresCommanderApproval: boolean
  summary: string
}

export type ActivationLifecyclePlan = {
  stages: ActivationStage[]
  events: ActivationLifecycleEvent[]
  activeTransitions: number
  blockedTransitions: number
  lifecycleRule: string
}

const ORDERED_STAGES: ActivationStage[] = [
  'proposed',
  'blueprint_review',
  'governance_review',
  'memory_binding',
  'queue_assignment',
  'readiness_validation',
  'commander_approval',
  'active',
]

export function planLifecycleTransitions(
  candidates: ActivationAgentCandidate[],
  approvals: ActivationApprovalDecision[],
  readiness: ActivationReadinessState[],
): ActivationLifecyclePlan {
  const events = candidates.flatMap((candidate, candidateIndex) => {
    const approval = approvals[candidateIndex]
    const ready = readiness[candidateIndex]
    return ORDERED_STAGES.slice(1).map((stage, stageIndex) => {
      const from = ORDERED_STAGES[stageIndex]
      const needsCommander = stage === 'active' || stage === 'commander_approval'
      const allowed = stage === 'active'
        ? approval.canTransitionActive
        : stage === 'commander_approval'
          ? ready.canRequestCommanderApproval
          : ready.blockers.length === 0 || stageIndex < 2
      return {
        agentId: candidate.agentId,
        from,
        to: stage,
        allowed,
        requiresAudit: true as const,
        requiresDoctrineValidation: true as const,
        requiresCommanderApproval: needsCommander,
        summary: allowed
          ? `${candidate.name} may enter ${stage} when the previous audited stage is complete.`
          : `${candidate.name} is held before ${stage}: ${[...ready.blockers, ...approval.reasons].join(' ') || 'approval incomplete'}`,
      }
    })
  })

  return {
    stages: ORDERED_STAGES,
    events,
    activeTransitions: events.filter(event => event.to === 'active' && event.allowed).length,
    blockedTransitions: events.filter(event => !event.allowed).length,
    lifecycleRule: 'Activation advances through audited stages and cannot become active without readiness validation and Commander approval.',
  }
}
