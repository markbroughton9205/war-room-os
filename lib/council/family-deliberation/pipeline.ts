import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DeliberationSession, DeliberationTurn, DeliberationTurnRole } from './types'
import {
  CONTINUATION_POLICY,
  OPENING_POSITION_POLICY,
  createEmptyStageRecord,
  runtimeTruthFromTurn,
  type DeliberationPipelineOutcome,
  type DeliberationPipelineProvenance,
  type DeliberationStageId,
  type DeliberationStageRecord,
  type DeliberationStageStatus,
} from './stageContract'

const PRIMARY_ROLES: ReadonlySet<DeliberationTurnRole> = new Set(['direct_response', 'opening_position'])

export function isPrimaryRole(role: DeliberationTurnRole): boolean {
  return PRIMARY_ROLES.has(role)
}

export function completedPrimaryTurns(session: DeliberationSession): DeliberationTurn[] {
  return session.turns.filter(
    turn => isPrimaryRole(turn.turn_role)
      && turn.completion_status === 'complete'
      && Boolean(turn.output_message_id)
      && turn.full_response.trim().length > 0,
  )
}

export function challengeTurns(session: DeliberationSession): DeliberationTurn[] {
  return session.turns.filter(turn => turn.turn_role === 'red_team_challenge')
}

export function revisionTurns(session: DeliberationSession): DeliberationTurn[] {
  return session.turns.filter(turn => turn.turn_role === 'revision_or_stand_firm')
}

/**
 * Authoritative contribution per primary seat for synthesis.
 * REVISE replaces the primary contribution; STAND_FIRM / failed revision keep the original.
 * Original turns remain in session.turns as provenance.
 */
export function authoritativePrimaryTurns(session: DeliberationSession): DeliberationTurn[] {
  const primaries = completedPrimaryTurns(session)
  const bySeat = new Map<CouncilOrchestrationFamily, DeliberationTurn>()
  for (const primary of primaries) {
    const revisions = revisionTurns(session).filter(
      turn => turn.provider_family === primary.provider_family
        && turn.revision_of_message_id === primary.output_message_id,
    )
    const successfulRevise = [...revisions].reverse().find(
      turn => turn.completion_status === 'complete'
        && turn.revision_status === 'revised'
        && turn.full_response.trim().length > 0
        && Boolean(turn.output_message_id),
    )
    bySeat.set(primary.provider_family, successfulRevise ?? primary)
  }
  return [...bySeat.values()].sort((a, b) => a.speaking_order - b.speaking_order)
}

export function seatsChallengedByPhoenix(
  session: DeliberationSession,
  challenge: DeliberationTurn | null,
): DeliberationTurn[] {
  if (!challenge || challenge.completion_status !== 'complete' || !challenge.output_message_id) return []
  const targets = new Set(challenge.challenge_target_ids)
  return completedPrimaryTurns(session).filter(
    turn => turn.output_message_id && targets.has(turn.output_message_id),
  )
}

export type SynthesisGateResult = {
  canSynthesize: boolean
  outcomeIfSynthesized: Exclude<DeliberationPipelineOutcome, 'FAILED'> | 'FAILED'
  reasons: string[]
  authoritativeTurnIds: string[]
  failedSeats: CouncilOrchestrationFamily[]
  missingCritical: boolean
}

/**
 * Synthesis proceeds when enough valid primary material exists.
 * Optional seat failures do not block synthesis; they degrade truth.
 * Fabricating missing seats is never allowed.
 */
export function evaluateSynthesisGate(session: DeliberationSession): SynthesisGateResult {
  const authoritative = authoritativePrimaryTurns(session)
  const failedSeats = [...new Set(
    session.turns
      .filter(turn => turn.completion_status !== 'complete' && turn.turn_role !== 'council_synthesis')
      .map(turn => turn.provider_family),
  )]
  const phoenix = challengeTurns(session).find(turn => turn.completion_status === 'complete')
  const phoenixAttempted = challengeTurns(session).length > 0
  const phoenixFailed = phoenixAttempted && !phoenix
  const revisionFailed = revisionTurns(session).some(turn => turn.completion_status !== 'complete')
  const reasons: string[] = []

  if (authoritative.length === 0) {
    reasons.push('No completed primary contributions available for synthesis.')
    return {
      canSynthesize: false,
      outcomeIfSynthesized: 'FAILED',
      reasons,
      authoritativeTurnIds: [],
      failedSeats,
      missingCritical: true,
    }
  }

  let degraded = false
  if (failedSeats.length > 0) {
    degraded = true
    reasons.push(`Partial roster: failed/unavailable seats recorded as ${failedSeats.join(', ')}.`)
  }
  if (phoenixFailed) {
    degraded = true
    reasons.push('PHOENIX challenge failed; synthesis may proceed degraded from primary material.')
  }
  if (revisionFailed) {
    degraded = true
    reasons.push('One or more revision turns failed; prior authoritative contributions retained.')
  }
  if (!phoenix && !phoenixAttempted) {
    // Social/fast paths may skip challenge — not automatically degraded if intentional.
  } else if (!phoenix && phoenixAttempted) {
    degraded = true
  }

  return {
    canSynthesize: true,
    outcomeIfSynthesized: degraded ? 'DEGRADED' : 'COMPLETE',
    reasons: reasons.length ? reasons : ['Sufficient primary material for synthesis.'],
    authoritativeTurnIds: authoritative.map(turn => turn.turn_id),
    failedSeats,
    missingCritical: false,
  }
}

export function derivePipelineOutcome(session: DeliberationSession): DeliberationPipelineOutcome {
  const synthesis = session.synthesis_turn_id
    ? session.turns.find(turn => turn.turn_id === session.synthesis_turn_id)
    : null
  const gate = evaluateSynthesisGate(session)
  if (synthesis?.completion_status === 'complete' && synthesis.output_message_id) {
    return gate.outcomeIfSynthesized === 'FAILED' ? 'DEGRADED' : gate.outcomeIfSynthesized
  }
  if (gate.canSynthesize && synthesis && synthesis.completion_status !== 'complete') {
    return 'FAILED'
  }
  if (!gate.canSynthesize) return 'FAILED'
  if (authoritativePrimaryTurns(session).length > 0) return 'DEGRADED'
  return 'FAILED'
}

export function synthesisInputMessageIds(session: DeliberationSession): string[] {
  const ids = new Set<string>([session.commander_message_id])
  for (const turn of authoritativePrimaryTurns(session)) {
    if (turn.output_message_id) ids.add(turn.output_message_id)
  }
  for (const challenge of challengeTurns(session)) {
    if (challenge.output_message_id && challenge.completion_status === 'complete') {
      ids.add(challenge.output_message_id)
    }
  }
  for (const revision of revisionTurns(session)) {
    if (revision.output_message_id && revision.completion_status === 'complete') {
      ids.add(revision.output_message_id)
    }
  }
  // Preserve failed seat markers for synthesis awareness via diagnostics, not fabricated ids.
  return [...ids]
}

export function buildSynthesisContextBlock(session: DeliberationSession): string {
  const gate = evaluateSynthesisGate(session)
  const authoritative = authoritativePrimaryTurns(session)
  const challenges = challengeTurns(session).filter(turn => turn.completion_status === 'complete')
  const revisions = revisionTurns(session)
  const lines = [
    'DELIBERATION SYNTHESIS CONTEXT (observable only):',
    `Pipeline outcome expectation: ${gate.outcomeIfSynthesized}`,
    `Authoritative primary contributions: ${authoritative.length}`,
    ...authoritative.map(turn => (
      `- seat=${turn.provider_label} role=${turn.turn_role} revision_status=${turn.revision_status} decision=${turn.revision_decision ?? 'n/a'} message=${turn.output_message_id}`
    )),
    challenges.length
      ? `PHOENIX challenge present: ${challenges.map(turn => turn.output_message_id).join(', ')}`
      : 'PHOENIX challenge present: no',
    ...revisions.map(turn => (
      `- revision seat=${turn.provider_label} decision=${turn.revision_decision ?? turn.revision_status} challenge_addressed=${turn.challenge_addressed ?? 'n/a'} of=${turn.revision_of_message_id} status=${turn.completion_status}`
    )),
    gate.failedSeats.length
      ? `Failed/missing seats (do NOT invent contributions): ${gate.failedSeats.join(', ')}`
      : 'Failed/missing seats: none',
    'Synthesize only from authoritative completed material. If the round is DEGRADED/PARTIAL, say so explicitly.',
  ]
  return lines.join('\n')
}

export function markStage(
  stage: DeliberationStageRecord,
  patch: Partial<DeliberationStageRecord> & { status: DeliberationStageStatus },
): DeliberationStageRecord {
  return { ...stage, ...patch }
}

export function finalizeStageFromTurns(
  stageId: DeliberationStageId,
  seats: CouncilOrchestrationFamily[],
  evidenceIds: string[],
  turns: DeliberationTurn[],
  extras?: Partial<DeliberationStageRecord>,
): DeliberationStageRecord {
  const stageTurns = turns.filter(turn => turn.turn_role === stageId)
  const anyComplete = stageTurns.some(turn => turn.completion_status === 'complete')
  const anyFailed = stageTurns.some(turn => turn.completion_status !== 'complete')
  const status: DeliberationStageStatus =
    stageTurns.length === 0
      ? 'skipped'
      : anyComplete && anyFailed
        ? 'degraded'
        : anyComplete
          ? 'complete'
          : 'failed'
  return {
    ...createEmptyStageRecord(stageId, seats, evidenceIds),
    status,
    result_turn_ids: stageTurns.map(turn => turn.turn_id),
    prior_turn_ids: [...new Set(stageTurns.flatMap(turn => turn.input_message_ids))],
    challenge_turn_ids: stageId === 'red_team_challenge'
      ? stageTurns.map(turn => turn.turn_id)
      : stageTurns.flatMap(turn => turn.challenge_target_ids),
    revision_target_turn_ids: stageTurns
      .map(turn => turn.revision_of_message_id)
      .filter((id): id is string => Boolean(id)),
    failure_reason: stageTurns.find(turn => turn.failure_reason)?.failure_reason ?? null,
    provider_runtime_truth: stageTurns.map(runtimeTruthFromTurn),
    started_at: stageTurns[0]?.started_at ?? null,
    completed_at: stageTurns.at(-1)?.completed_at ?? null,
    ...extras,
  }
}

export function buildPipelineProvenance(session: DeliberationSession): DeliberationPipelineProvenance {
  const evidenceIds = session.evidence_references.map(ref => ref.evidence_reference_id)
  const primarySeats = [...new Set(
    session.turns.filter(turn => isPrimaryRole(turn.turn_role)).map(turn => turn.provider_family),
  )]
  const challenge = challengeTurns(session)
  const revisions = revisionTurns(session)
  const stages: DeliberationStageRecord[] = [
    finalizeStageFromTurns('direct_response', primarySeats, evidenceIds, session.turns.filter(turn => isPrimaryRole(turn.turn_role)).map(turn => ({
      ...turn,
      turn_role: 'direct_response' as const,
    }))),
    finalizeStageFromTurns('red_team_challenge', ['red_team'], evidenceIds, session.turns),
    finalizeStageFromTurns(
      'revision_or_stand_firm',
      [...new Set(revisions.map(turn => turn.provider_family))],
      evidenceIds,
      session.turns,
    ),
    finalizeStageFromTurns('council_synthesis', ['chatgpt'], evidenceIds, session.turns),
  ]
  const outcome = derivePipelineOutcome(session)
  const gate = evaluateSynthesisGate(session)
  return {
    schema_version: '16.deliberation-pipeline.v1',
    stages_executed: stages,
    outcome,
    opening_position_policy: OPENING_POSITION_POLICY,
    continuation_policy: CONTINUATION_POLICY,
    authoritative_turn_ids: gate.authoritativeTurnIds,
    challenge_linkage: challenge.map(turn => ({
      challenge_turn_id: turn.turn_id,
      target_turn_ids: [...turn.challenge_target_ids],
    })),
    revision_linkage: revisions.map(turn => ({
      revision_turn_id: turn.turn_id,
      original_turn_id: turn.revision_of_message_id,
      decision: turn.revision_decision ?? null,
    })),
    synthesis_turn_id: session.synthesis_turn_id,
    failed_seats: gate.failedSeats,
    evidence_ids: evidenceIds,
  }
}

export function applyPipelineProvenance(session: DeliberationSession): DeliberationSession {
  const pipeline = buildPipelineProvenance(session)
  session.pipeline = pipeline
  session.completion_status =
    pipeline.outcome === 'COMPLETE'
      ? 'complete'
      : pipeline.outcome === 'DEGRADED'
        ? 'partial'
        : 'failed'
  if (pipeline.outcome === 'DEGRADED') {
    session.diagnostics.push('Deliberation outcome DEGRADED: partial roster or stage failure with usable material retained.')
  }
  if (pipeline.outcome === 'FAILED') {
    session.diagnostics.push('Deliberation outcome FAILED: insufficient material or synthesis failure.')
  }
  session.diagnostics.push(
    `opening_position policy=${OPENING_POSITION_POLICY}; continuation=${CONTINUATION_POLICY} (not a #16 blocker).`,
  )
  return session
}
