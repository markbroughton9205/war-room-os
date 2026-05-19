import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export const COGNITIVE_BUS_EVENT_TYPES = [
  'signal_received',
  'provider_packet',
  'contradiction_raised',
  'challenge',
  'synthesis_step',
  'delegation',
  'escalation',
  'routing',
  'operator_packet',
] as const

export type CognitiveBusEventType = (typeof COGNITIVE_BUS_EVENT_TYPES)[number]

export type CognitiveBusEventBase = {
  id: string
  threadId: string
  type: CognitiveBusEventType
  at: string
  correlationId?: string
}

export type CognitiveBusEvent = CognitiveBusEventBase & {
  payload: Record<string, unknown>
}

export type ProviderPacketIntegrityStatus = 'verified' | 'degraded' | 'incomplete' | 'unknown'

export type StructuredProviderPacket = {
  provider_id: string
  family: CouncilOrchestrationFamily
  timestamp: string
  integrity_status: ProviderPacketIntegrityStatus
  observations: string[]
  confidence: number
  contradictions: string[]
  recommendations: string[]
  escalation_requests: string[]
}

export type OperatorPacketStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED'

export type OperatorPacket = {
  thread_id: string
  status: OperatorPacketStatus
  synthesis_summary: string
  consensus_state: 'ALIGNED' | 'CONFLICTED' | 'INSUFFICIENT_EVIDENCE'
  family_packets: StructuredProviderPacket[]
  open_contradictions: string[]
  escalation_pending: boolean
  commander_approval_required: boolean
  generated_at: string
}

export type CouncilThreadState = {
  threadId: string
  phase: 'intake' | 'specialize' | 'synthesize' | 'red_team' | 'operator_packet' | 'closed'
  correlationId: string | null
  operatorPacket: OperatorPacket | null
  lastEventAt: string | null
  inheritedContext: Record<string, unknown>
}
