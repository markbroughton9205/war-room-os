import type { StructuredProviderPacket } from '@/lib/cognitive-bus/types'
import type { CouncilTaskType } from '@/lib/provider-specialization/routing'
import { scoreFamilyForTask } from '@/lib/provider-specialization/routing'

export type OrchestrationPriorityInput = {
  taskType: CouncilTaskType
  decree: string
  packet?: StructuredProviderPacket
  hasContradiction?: boolean
  escalationPending?: boolean
}

const TASK_BASE: Record<CouncilTaskType, number> = {
  signal_intake: 0.72,
  risk_review: 0.78,
  red_team_challenge: 0.8,
  synthesis: 0.65,
  research: 0.6,
  revenue: 0.58,
  general: 0.5,
}

export function scoreOrchestrationPriority(input: OrchestrationPriorityInput): number {
  let score = TASK_BASE[input.taskType] ?? 0.5
  const decreeLen = (input.decree ?? '').trim().length
  if (decreeLen > 240) score += 0.05
  if (/\burgent|emergency|critical|blocker\b/i.test(input.decree)) score += 0.12
  if (input.hasContradiction) score += 0.1
  if (input.escalationPending) score += 0.15
  if (input.packet) {
    score += input.packet.confidence * 0.08
    score += scoreFamilyForTask(input.packet.family, input.taskType) * 0.1
    if (input.packet.escalation_requests.length) score += 0.12
  }
  return Math.min(1, Math.round(score * 1000) / 1000)
}
