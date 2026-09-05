import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { BackendMetadata, BackendType } from '@/lib/council/live-orchestration/backends/types'
import type { DeliberationSession, DeliberationTurn } from '@/lib/council/family-deliberation/types'
import { nebulaAgentForSeat, type NebulaAgentId } from './identity'

/**
 * Inspectable Council round + per-agent provenance. Phase 1 foundation: types and projections
 * over the existing deliberation/request-state stores. Not a second lifecycle engine.
 */

export type NebulaRoundHealthStatus = 'complete' | 'partial' | 'failed'

export type NebulaAgentRoundStatus = 'OK' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE' | 'SKIPPED'

export type NebulaAgentResponseProvenance = {
  roundId: string
  agentId: NebulaAgentId | null
  seatId: CouncilOrchestrationFamily
  role: string
  backendType: BackendType | null
  provider: string | null
  runtime: string | null
  model: string | null
  status: NebulaAgentRoundStatus
  startedAt: string
  completedAt: string | null
  fallbackFrom: BackendType | null
  attempt: number
  errorCode: string | null
}

export type NebulaRoundHealthFailure = {
  seatId: CouncilOrchestrationFamily
  agentId: NebulaAgentId | null
  status: NebulaAgentRoundStatus
  errorCode: string | null
  safeMessage: string
}

export type NebulaRoundHealth = {
  roundId: string
  participatingSeats: CouncilOrchestrationFamily[]
  successfulSeats: CouncilOrchestrationFamily[]
  failures: NebulaRoundHealthFailure[]
  synthesizerSeat: 'chatgpt'
  synthesizerIdentity: 'AURORA'
  synthesisAvailable: boolean
  synthesisReady: boolean
  status: NebulaRoundHealthStatus
  requested: number
  completed: number
  failed: number
  timedOut: number
  fallbackCount: number
  evidenceCoverage: 'full' | 'partial' | 'none'
  unresolvedContradictions: number
  degraded: boolean
}

export function projectProvenanceFromTurn(
  turn: DeliberationTurn,
  backend?: Pick<BackendMetadata, 'backendType' | 'provider' | 'model' | 'host' | 'fallbackFrom' | 'failureClass'> | null,
): NebulaAgentResponseProvenance {
  const agent = nebulaAgentForSeat(turn.provider_family)
  const status: NebulaAgentRoundStatus =
    turn.completion_status === 'complete'
      ? 'OK'
      : turn.completion_status === 'timed_out'
        ? 'TIMED_OUT'
        : turn.completion_status === 'unavailable'
          ? 'UNAVAILABLE'
          : turn.completion_status === 'unresolved'
            ? 'SKIPPED'
            : 'FAILED'
  return {
    roundId: turn.round_id,
    agentId: agent?.id ?? null,
    seatId: turn.provider_family,
    role: turn.turn_role,
    backendType: backend?.backendType ?? null,
    provider: backend?.provider ?? null,
    runtime: backend?.host ?? null,
    model: backend?.model ?? turn.provider_model,
    status,
    startedAt: turn.started_at,
    completedAt: turn.completed_at,
    fallbackFrom: backend?.fallbackFrom ?? turn.fallback_from ?? null,
    attempt: 1,
    errorCode: turn.failure_reason ? (backend?.failureClass ?? turn.completion_status) : null,
  }
}

function evidenceCoverageFromSession(session: DeliberationSession): 'full' | 'partial' | 'none' {
  if (!session.evidence_references.length) return 'none'
  const completedTurns = session.turns.filter(turn => turn.completion_status === 'complete' && turn.output_message_id)
  if (completedTurns.some(turn => turn.evidence_reference_ids.length === 0)) return 'partial'
  return 'full'
}

export function projectRoundHealth(session: DeliberationSession): NebulaRoundHealth {
  const failures: NebulaRoundHealthFailure[] = []
  const successfulSeats: CouncilOrchestrationFamily[] = []
  const participatingSeats: CouncilOrchestrationFamily[] = []
  for (const turn of session.turns) {
    if (!participatingSeats.includes(turn.provider_family)) participatingSeats.push(turn.provider_family)
    const agent = nebulaAgentForSeat(turn.provider_family)
    if (turn.completion_status === 'complete' && turn.output_message_id) {
      if (!successfulSeats.includes(turn.provider_family)) successfulSeats.push(turn.provider_family)
      continue
    }
    failures.push({
      seatId: turn.provider_family,
      agentId: agent?.id ?? null,
      status:
        turn.completion_status === 'timed_out'
          ? 'TIMED_OUT'
          : turn.completion_status === 'unavailable'
            ? 'UNAVAILABLE'
            : turn.completion_status === 'unresolved'
              ? 'SKIPPED'
              : 'FAILED',
      errorCode: turn.completion_status,
      safeMessage: turn.failure_reason || `${agent?.name ?? turn.provider_label} did not complete this round.`,
    })
  }
  const synthesisTurn = session.synthesis_turn_id
    ? session.turns.find(turn => turn.turn_id === session.synthesis_turn_id)
    : null
  const synthesisAvailable = synthesisTurn?.completion_status === 'complete' && Boolean(synthesisTurn.output_message_id)
  const timedOut = failures.filter(item => item.status === 'TIMED_OUT').length
  const failed = failures.filter(item => item.status === 'FAILED' || item.status === 'UNAVAILABLE').length
  const fallbackCount = session.turns.filter(turn => Boolean(turn.fallback_from)).length
  const unresolvedContradictions = session.turns.reduce((sum, turn) => sum + turn.direct_disagreements.length, 0)
  const status: NebulaRoundHealthStatus = synthesisAvailable
    ? 'complete'
    : successfulSeats.length > 0
      ? 'partial'
      : 'failed'
  return {
    roundId: session.round_id,
    participatingSeats,
    successfulSeats,
    failures,
    synthesizerSeat: 'chatgpt',
    synthesizerIdentity: 'AURORA',
    synthesisAvailable,
    synthesisReady: synthesisAvailable,
    status,
    requested: participatingSeats.length,
    completed: successfulSeats.length,
    failed,
    timedOut,
    fallbackCount,
    evidenceCoverage: evidenceCoverageFromSession(session),
    unresolvedContradictions,
    degraded: failures.length > 0,
  }
}

/** AURORA must know when it is synthesizing a degraded/partial round. Never pretend a failed seat responded. */
export function auroraDegradedRoundNotice(health: NebulaRoundHealth): string | null {
  if (!health.degraded) return null
  const missing = health.failures.map(item => item.agentId ? item.agentId.toUpperCase() : item.seatId).join(', ')
  return `This Council round is degraded. Failed or unavailable: ${missing}. Do not invent responses for missing seats. Synthesize only from completed findings and name the gap.`
}

/** Failures belong in round health / Inspector, not as primary conversation cards. */
export function shouldSurfaceFailureInConversation(health: NebulaRoundHealth): boolean {
  return health.status === 'failed' && health.successfulSeats.length === 0
}
