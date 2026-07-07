import type {
  ApprovalDecision,
  EntityRoutingDecision,
  IntentClassification,
  RoutingNote,
  SkillRoutingDecision,
} from './types'

function createRoutingId(timestamp: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `routing_${timestamp.replace(/[^0-9]/g, '')}_${randomPart}`
}

function averageConfidence(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round((total / values.length) * 100) / 100
}

export function createRoutingNote(input: {
  intent: IntentClassification
  skillDecision: SkillRoutingDecision
  entityDecision: EntityRoutingDecision
  approvalDecision: ApprovalDecision
  reason: string
  decisionPath: string[]
  timestamp?: string
  routingId?: string
}): RoutingNote {
  const timestamp = input.timestamp ?? new Date().toISOString()

  return {
    routingId: input.routingId ?? createRoutingId(timestamp),
    intent: input.intent.intent,
    routingConfidence: averageConfidence([
      input.intent.confidence,
      input.skillDecision.confidence,
      input.entityDecision.confidence,
    ]),
    candidateSkillIds: input.skillDecision.candidateSkillIds,
    rejectedSkillIds: input.skillDecision.rejectedSkillIds,
    selectedSkillIds: input.skillDecision.selectedSkillIds,
    selectedEntityIds: input.entityDecision.selectedEntityIds,
    approvalRequired: input.approvalDecision.approvalRequired,
    riskLevel: input.approvalDecision.riskLevel,
    reason: input.reason,
    decisionPath: input.decisionPath,
    providerRecommendation: null,
    timestamp,
  }
}
