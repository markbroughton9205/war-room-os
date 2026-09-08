import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import { REPORT_KIND_BY_AGENT, SWARM_SEAT_BY_AGENT, type FrozenSeatReport, type PrivateSeatLedger, type SeatAssignment } from './types'

export function freezeIndependentSeatReport(input: {
  agentId: Exclude<NebulaAgentId, 'astra'>
  assignment: SeatAssignment | null
  conclusion: string
  ledger: PrivateSeatLedger | null
  missionId: string
  roundRequestId: string
  logicalRequestId: string
  nowIso?: string
  scoutSummary?: string
  uncertainties?: string[]
  contradictions?: string[]
  unanswered?: string[]
  confidence?: number | null
}): FrozenSeatReport {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const seat = SWARM_SEAT_BY_AGENT[input.agentId]
  return {
    report_id: `report-${input.agentId}-${input.roundRequestId}`,
    report_kind: REPORT_KIND_BY_AGENT[input.agentId],
    mission_id: input.missionId,
    roundRequestId: input.roundRequestId,
    logicalRequestId: input.logicalRequestId,
    seat,
    agentId: input.agentId,
    createdAt: nowIso,
    frozen_at: nowIso,
    phase: input.agentId === 'aurora' ? 'SYNTHESIS' : 'POSITION_FREEZE',
    assignment: input.assignment?.objective ?? '',
    conclusion: input.conclusion.trim(),
    evidence_ids: input.ledger ? [...new Set(input.ledger.evidence.map(item => item.id))] : [],
    confidence: input.confidence ?? null,
    uncertainties: input.uncertainties ?? [],
    contradictions: input.contradictions ?? [],
    unanswered_questions: input.unanswered ?? [],
    scout_summary: input.scoutSummary ?? '',
    immutable: true,
  }
}

export function reportIsImmutable(report: FrozenSeatReport): boolean {
  return report.immutable === true && Boolean(report.frozen_at) && Boolean(report.report_id)
}

export function reviseWithoutRewriting(
  original: FrozenSeatReport,
  revisionText: string,
): { original: FrozenSeatReport; revisionText: string } {
  return { original, revisionText }
}

export function allRequiredReportsFrozen(
  required: NebulaAgentId[],
  reports: FrozenSeatReport[],
): boolean {
  return required.every(agentId => reports.some(report => report.agentId === agentId && report.immutable && report.frozen_at))
}
