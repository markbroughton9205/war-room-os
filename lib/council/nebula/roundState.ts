import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { NebulaAgentId } from './identity'
import type { AstraIntent, CouncilRoundPlan } from './roundFlow'
import type { NebulaRoundHealth } from './round'

export const COUNCIL_ROUND_STATUSES = [
  'CREATED',
  'PLANNING',
  'EXECUTING',
  'SYNTHESIZING',
  'COMPLETE',
  'COMPLETE_DEGRADED',
  'FAILED',
  'CANCELLED',
] as const

export type CouncilRoundStatus = (typeof COUNCIL_ROUND_STATUSES)[number]

export type CouncilRoundAgentState = {
  agentId: NebulaAgentId
  seatId: CouncilOrchestrationFamily | null
  status: 'queued' | 'started' | 'completed' | 'retrying' | 'skipped' | 'failed'
  startedAt: string | null
  completedAt: string | null
}

export type CouncilRoundMetrics = {
  submit_to_ack_ms: number | null
  submit_to_round_created_ms: number | null
  astra_plan_ms: number | null
  agent_queue_ms: number | null
  agent_ttft_ms: number | null
  agent_tokens_per_second: number | null
  agent_total_ms: number | null
  aurora_ttft_ms: number | null
  round_total_ms: number | null
  model_load_ms: number | null
  render_delay_ms: number | null
  queue_depth: number
}

export type CouncilRound = {
  roundId: string
  requestId: string
  status: CouncilRoundStatus
  intent: AstraIntent
  selectedAgents: NebulaAgentId[]
  agentStates: Record<string, CouncilRoundAgentState>
  findings: unknown[]
  roundHealth: NebulaRoundHealth | null
  synthesis: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  metrics: CouncilRoundMetrics
  inheritedPriorRound: false
}

const TERMINAL: ReadonlySet<CouncilRoundStatus> = new Set([
  'COMPLETE',
  'COMPLETE_DEGRADED',
  'FAILED',
  'CANCELLED',
])

const TRANSITIONS: Record<CouncilRoundStatus, CouncilRoundStatus[]> = {
  CREATED: ['PLANNING', 'FAILED', 'CANCELLED'],
  PLANNING: ['EXECUTING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['SYNTHESIZING', 'COMPLETE', 'COMPLETE_DEGRADED', 'FAILED', 'CANCELLED'],
  SYNTHESIZING: ['COMPLETE', 'COMPLETE_DEGRADED', 'FAILED', 'CANCELLED'],
  COMPLETE: [],
  COMPLETE_DEGRADED: [],
  FAILED: [],
  CANCELLED: [],
}

export function emptyRoundMetrics(): CouncilRoundMetrics {
  return {
    submit_to_ack_ms: null,
    submit_to_round_created_ms: null,
    astra_plan_ms: null,
    agent_queue_ms: null,
    agent_ttft_ms: null,
    agent_tokens_per_second: null,
    agent_total_ms: null,
    aurora_ttft_ms: null,
    round_total_ms: null,
    model_load_ms: null,
    render_delay_ms: null,
    queue_depth: 0,
  }
}

export function createCouncilRound(params: {
  roundId: string
  requestId: string
  plan: CouncilRoundPlan
  createdAt?: string
}): CouncilRound {
  const createdAt = params.createdAt ?? new Date().toISOString()
  const agentStates: Record<string, CouncilRoundAgentState> = {}
  for (const agentId of params.plan.participatingAgentIds) {
    agentStates[agentId] = {
      agentId,
      seatId: null,
      status: 'queued',
      startedAt: null,
      completedAt: null,
    }
  }
  return {
    roundId: params.roundId,
    requestId: params.requestId,
    status: 'CREATED',
    intent: params.plan.intent,
    selectedAgents: [...params.plan.participatingAgentIds],
    agentStates,
    findings: [],
    roundHealth: null,
    synthesis: null,
    createdAt,
    startedAt: null,
    completedAt: null,
    metrics: emptyRoundMetrics(),
    inheritedPriorRound: false,
  }
}

export function canTransitionCouncilRound(from: CouncilRoundStatus, to: CouncilRoundStatus): boolean {
  return TRANSITIONS[from]?.includes(to) === true
}

export function transitionCouncilRound(round: CouncilRound, to: CouncilRoundStatus): CouncilRound {
  if (round.status === to) return round
  if (!canTransitionCouncilRound(round.status, to)) {
    throw new Error(`Illegal CouncilRound transition ${round.status} → ${to}`)
  }
  return {
    ...round,
    status: to,
    startedAt: to === 'EXECUTING' ? (round.startedAt ?? new Date().toISOString()) : round.startedAt,
    completedAt: TERMINAL.has(to) ? new Date().toISOString() : round.completedAt,
  }
}

export function isTerminalCouncilRoundStatus(status: CouncilRoundStatus): boolean {
  return TERMINAL.has(status)
}

export function terminalStatusFromHealth(health: NebulaRoundHealth | null): CouncilRoundStatus {
  if (!health) return 'FAILED'
  if (health.status === 'failed') return 'FAILED'
  if (health.status === 'complete' && !health.degraded) return 'COMPLETE'
  return 'COMPLETE_DEGRADED'
}

export function roundDoesNotInheritPriorState(round: CouncilRound): boolean {
  return round.inheritedPriorRound === false && round.findings.length === 0 && round.roundHealth === null
}
