import {
  ASCENSION_AUTONOMY_GUARD,
  LESSON_TERMINAL_STATES,
  type CommanderApprovalRequiredChange,
  type LessonCandidate,
  type LessonPromotionStatus,
  type PromotionGateId,
  type PromotionGateResult,
} from './types'
import { isTestableLessonCandidate } from './lessons'

const GATES: readonly PromotionGateId[] = [
  'provenance',
  'target_improvement',
  'regression',
  'role_adherence',
  'cost',
  'latency',
  'safety',
  'human_review',
]

export const COMMANDER_APPROVAL_REQUIRED_CHANGES: readonly CommanderApprovalRequiredChange[] = [
  'permanent_identity',
  'authority',
  'role_boundary',
  'memory_access_scope',
  'tool_permissions',
  'core_temperament_ranges',
]

export function requiresCommanderApproval(_change: CommanderApprovalRequiredChange): true {
  return true
}

export type PromotionEvaluationInput = {
  candidate: LessonCandidate
  provenanceComplete: boolean
  targetImprovementObserved: boolean
  regressionDetected: boolean
  roleAdherenceMaintained: boolean
  costAcceptable: boolean
  latencyAcceptable: boolean
  safetyClear: boolean
  humanReviewPassed: boolean
  commanderApproved: boolean
}

export function evaluatePromotionGates(input: PromotionEvaluationInput): PromotionGateResult[] {
  return [
    { gate: 'provenance', passed: input.provenanceComplete && input.candidate.sourceEpisodeIds.length > 0, detail: 'source episodes required' },
    { gate: 'target_improvement', passed: input.targetImprovementObserved && Boolean(input.candidate.expectedBenefit.trim()), detail: 'expected benefit must be evidenced' },
    { gate: 'regression', passed: !input.regressionDetected, detail: 'no confirmed regression' },
    { gate: 'role_adherence', passed: input.roleAdherenceMaintained, detail: 'must remain inside role contract' },
    { gate: 'cost', passed: input.costAcceptable, detail: 'cost within budget' },
    { gate: 'latency', passed: input.latencyAcceptable, detail: 'latency within budget' },
    { gate: 'safety', passed: input.safetyClear && !ASCENSION_AUTONOMY_GUARD.selfModificationEnabled, detail: 'safety clear; autonomy off' },
    { gate: 'human_review', passed: input.humanReviewPassed && input.commanderApproved, detail: 'human review + Commander approval' },
  ]
}

export function allPromotionGatesExist(): boolean {
  return GATES.length === 8
}

export function decideLessonPromotion(input: PromotionEvaluationInput): LessonPromotionStatus {
  if (!isTestableLessonCandidate(input.candidate)) return 'rejected'
  if (LESSON_TERMINAL_STATES.includes(input.candidate.promotionStatus) && input.candidate.promotionStatus !== 'rejected') {
    return input.candidate.promotionStatus
  }
  if (ASCENSION_AUTONOMY_GUARD.unvalidatedPromotionEnabled) return 'rejected'
  const gates = evaluatePromotionGates(input)
  if (gates.some(gate => !gate.passed)) return 'rejected'
  return 'promoted'
}

export function productionBehaviorMayChange(status: LessonPromotionStatus): boolean {
  return status === 'promoted'
}

export function experienceIsNotPromotion(status: LessonPromotionStatus): boolean {
  return status === 'candidate' || status === 'validating' || status === 'comparing' || status === 'shadow' || status === 'canary'
}
