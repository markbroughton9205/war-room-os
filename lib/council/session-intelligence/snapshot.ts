import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import type {
  DeliberationEvidenceReference,
  DeliberationSession,
  DeliberationTurn,
} from '@/lib/council/family-deliberation/types'
import {
  COUNCIL_SESSION_INTELLIGENCE_VERSION,
  MAX_CONCLUSION_CHARS,
  MAX_DIGEST_CHARS,
  MAX_DURABLE_ROUNDS,
  MAX_OBJECTIVE_CHARS,
  MAX_QUESTION_CHARS,
  MAX_TURN_SUMMARY_CHARS,
  type BuildRoundSnapshotInput,
  type CouncilSessionIntelligenceV1,
  type DurableContinuationContext,
  type DurableDeliberationRound,
  type DurableEvidenceRef,
  type DurableProviderRuntimeTruth,
  type DurableSessionDigest,
  type DurableTurnRef,
  type SessionRoundOutcome,
} from './types'

export function clampText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function resolveConversationId(session: DeliberationSession, fallback?: string | null): string {
  const fromSession = typeof session.session_id === 'string' ? session.session_id.trim() : ''
  if (fromSession) return fromSession
  const fromFallback = typeof fallback === 'string' ? fallback.trim() : ''
  return fromFallback
}

export function resolveRoundId(session: DeliberationSession): string {
  const round = typeof session.round_id === 'string' ? session.round_id.trim() : ''
  if (round) return round
  const commander = typeof session.commander_turn_id === 'string' ? session.commander_turn_id.trim() : ''
  return commander || `round-${Date.now()}`
}

function nebulaIdForSeat(seat: CouncilOrchestrationFamily, turn?: DeliberationTurn): string | null {
  if (typeof turn?.agent_identity === 'string' && turn.agent_identity.trim()) {
    return turn.agent_identity.trim().toUpperCase()
  }
  return displayNameForSeat(seat).toUpperCase()
}

function reasoningRoleForSeat(seat: CouncilOrchestrationFamily): string | null {
  const map: Partial<Record<CouncilOrchestrationFamily, string>> = {
    chatgpt: 'synthesis',
    claude: 'systems',
    grok: 'evidence',
    gemini: 'calibration',
    red_team: 'challenge',
    nova: 'strategy',
    baby: 'session_assist',
  }
  return map[seat] ?? null
}

export function buildProviderTruth(turn: DeliberationTurn): DurableProviderRuntimeTruth {
  return {
    seatId: turn.provider_family,
    nebulaId: nebulaIdForSeat(turn.provider_family, turn),
    reasoningRole: reasoningRoleForSeat(turn.provider_family),
    providerLabel: turn.provider_label,
    providerModel: turn.provider_model,
    backendType: turn.backend_type ?? null,
    backendProvider: turn.backend_provider ?? null,
    backendRuntime: turn.backend_runtime ?? null,
    completionStatus: turn.completion_status,
    fallbackFrom: turn.fallback_from ?? null,
  }
}

function buildTurnRef(
  turn: DeliberationTurn,
  messageIdByTurnId?: Record<string, string>,
): DurableTurnRef {
  return {
    turnId: turn.turn_id,
    messageId: messageIdByTurnId?.[turn.turn_id]
      ?? (typeof turn.output_message_id === 'string' ? turn.output_message_id : null),
    seatId: turn.provider_family,
    nebulaId: nebulaIdForSeat(turn.provider_family, turn),
    reasoningRole: reasoningRoleForSeat(turn.provider_family),
    stage: turn.turn_role,
    completionStatus: turn.completion_status,
    challengeTargetIds: [...(turn.challenge_target_ids ?? [])],
    revisionOfTurnId: turn.revision_of_message_id,
    revisionDecision: turn.revision_decision ?? null,
    evidenceIds: [...(turn.evidence_ids_used ?? turn.evidence_reference_ids ?? [])],
    provider: buildProviderTruth(turn),
    summary: clampText(
      turn.executive_position || turn.recommended_action || turn.full_response,
      MAX_TURN_SUMMARY_CHARS,
    ),
  }
}

function mergeEvidenceRefs(
  session: DeliberationSession,
  roundId: string,
  prior: CouncilSessionIntelligenceV1 | null | undefined,
): DurableEvidenceRef[] {
  const priorById = new Map<string, DurableEvidenceRef>()
  for (const round of prior?.rounds ?? []) {
    for (const ref of round.evidenceRefs) {
      priorById.set(ref.evidenceId, ref)
    }
  }

  const out: DurableEvidenceRef[] = []
  const seen = new Set<string>()
  for (const ev of session.evidence_references ?? []) {
    const id = ev.evidence_reference_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const previous = priorById.get(id)
    if (previous) {
      const reused = previous.reusedInRoundIds.includes(roundId)
        ? previous.reusedInRoundIds
        : [...previous.reusedInRoundIds, roundId]
      out.push({
        ...previous,
        reusedInRoundIds: reused,
        // Historical freshness from first introduction is preserved; do not rewrite.
      })
    } else {
      out.push(toDurableEvidence(ev, roundId))
    }
  }

  // Also include pipeline evidence ids that may lack rich references.
  for (const id of session.pipeline?.evidence_ids ?? []) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const previous = priorById.get(id)
    if (previous) {
      out.push({
        ...previous,
        reusedInRoundIds: previous.reusedInRoundIds.includes(roundId)
          ? previous.reusedInRoundIds
          : [...previous.reusedInRoundIds, roundId],
      })
    } else {
      out.push({
        evidenceId: id,
        label: id,
        sourceKind: 'unknown',
        url: null,
        originType: null,
        observedFreshness: null,
        firstIntroducedRoundId: roundId,
        reusedInRoundIds: [],
      })
    }
  }
  return out
}

function toDurableEvidence(
  ev: DeliberationEvidenceReference,
  roundId: string,
): DurableEvidenceRef {
  return {
    evidenceId: ev.evidence_reference_id,
    label: ev.label,
    sourceKind: ev.source_kind,
    url: ev.url,
    originType: ev.origin_type ?? null,
    observedFreshness: null,
    firstIntroducedRoundId: roundId,
    reusedInRoundIds: [],
  }
}

function resolveOutcome(
  session: DeliberationSession,
  interrupted?: boolean,
): SessionRoundOutcome {
  if (interrupted) return 'INTERRUPTED'
  if (session.pipeline?.outcome) return session.pipeline.outcome
  if (session.completion_status === 'complete') return 'COMPLETE'
  if (session.completion_status === 'partial') return 'DEGRADED'
  return 'FAILED'
}

function buildDegradedReasons(session: DeliberationSession, outcome: SessionRoundOutcome): string[] {
  const reasons: string[] = []
  if (outcome === 'DEGRADED' || outcome === 'FAILED' || outcome === 'INTERRUPTED') {
    for (const seat of session.pipeline?.failed_seats ?? []) {
      reasons.push(`seat_failed:${seat}`)
    }
    for (const turn of session.turns) {
      if (turn.completion_status === 'failed' || turn.completion_status === 'timed_out' || turn.completion_status === 'unavailable') {
        reasons.push(`${turn.provider_family}:${turn.completion_status}${turn.failure_reason ? `:${clampText(turn.failure_reason, 80)}` : ''}`)
      }
    }
    for (const d of session.diagnostics ?? []) {
      const clipped = clampText(d, 120)
      if (clipped) reasons.push(clipped)
    }
  }
  return Array.from(new Set(reasons)).slice(0, 24)
}

export function buildContinuationContextFromRound(
  round: Pick<
    DurableDeliberationRound,
    | 'commanderRequest'
    | 'outcome'
    | 'failedSeats'
    | 'degradedReasons'
    | 'evidenceRefs'
    | 'turnRefs'
    | 'synthesisTurnRef'
  >,
): DurableContinuationContext {
  const synthesis = round.synthesisTurnRef
    ? round.turnRefs.find(t => t.turnId === round.synthesisTurnRef)
    : null
  const authoritative = round.turnRefs
    .filter(t =>
      t.stage === 'revision_or_stand_firm'
      || t.stage === 'direct_response'
      || t.stage === 'council_synthesis',
    )
    .filter(t => t.completionStatus === 'complete')
    .map(t => clampText(`${t.nebulaId ?? t.seatId}: ${t.summary ?? ''}`, MAX_CONCLUSION_CHARS))
    .filter((v): v is string => Boolean(v))
    .slice(0, 8)

  const unresolved: string[] = []
  if (round.outcome === 'DEGRADED' || round.outcome === 'FAILED' || round.outcome === 'INTERRUPTED') {
    for (const seat of round.failedSeats) {
      unresolved.push(`Missing or failed contribution from ${seat}`)
    }
  }

  return {
    previousObjective: clampText(round.commanderRequest, MAX_OBJECTIVE_CHARS),
    previousOutcome: round.outcome,
    previousSynthesisSummary: clampText(synthesis?.summary ?? null, MAX_CONCLUSION_CHARS),
    unresolvedQuestions: unresolved.slice(0, 8),
    authoritativeContributionSummaries: authoritative,
    evidenceIds: round.evidenceRefs.map(e => e.evidenceId).slice(0, 40),
    failedSeats: [...round.failedSeats],
    degradedReasons: [...round.degradedReasons].slice(0, 16),
  }
}

export function buildSessionDigest(
  rounds: DurableDeliberationRound[],
): DurableSessionDigest {
  const latest = rounds[rounds.length - 1] ?? null
  const conclusions: string[] = []
  const unresolved: string[] = []
  const evidenceIds = new Set<string>()

  for (const round of rounds) {
    const synth = round.synthesisTurnRef
      ? round.turnRefs.find(t => t.turnId === round.synthesisTurnRef)
      : null
    const conclusion = clampText(synth?.summary ?? null, MAX_CONCLUSION_CHARS)
    if (conclusion) conclusions.push(conclusion)
    for (const q of round.continuationContext.unresolvedQuestions) {
      const clipped = clampText(q, MAX_QUESTION_CHARS)
      if (clipped) unresolved.push(clipped)
    }
    for (const e of round.evidenceRefs) evidenceIds.add(e.evidenceId)
  }

  const digest: DurableSessionDigest = {
    currentObjective: clampText(latest?.commanderRequest ?? null, MAX_OBJECTIVE_CHARS),
    establishedConclusions: conclusions.slice(-6),
    unresolvedQuestions: unresolved.slice(-8),
    activeEvidenceIds: Array.from(evidenceIds).slice(-40),
    latestOutcome: latest?.outcome ?? null,
    lastSynthesis: clampText(
      latest?.synthesisTurnRef
        ? latest.turnRefs.find(t => t.turnId === latest.synthesisTurnRef)?.summary ?? null
        : null,
      MAX_CONCLUSION_CHARS,
    ),
    followUpState: latest ? 'awaiting_commander' : 'idle',
  }

  // Soft bound on total digest payload size.
  const encoded = JSON.stringify(digest)
  if (encoded.length > MAX_DIGEST_CHARS) {
    return {
      ...digest,
      establishedConclusions: digest.establishedConclusions.slice(-2),
      unresolvedQuestions: digest.unresolvedQuestions.slice(-3),
      activeEvidenceIds: digest.activeEvidenceIds.slice(-12),
    }
  }
  return digest
}

export function buildDurableRoundSnapshot(input: BuildRoundSnapshotInput): DurableDeliberationRound {
  const { session, conversationId, messageIdByTurnId, priorIntelligence, interrupted } = input
  const roundId = resolveRoundId(session)
  const convId = resolveConversationId(session, conversationId)
  const outcome = resolveOutcome(session, interrupted)
  const turnRefs = session.turns.map(t => buildTurnRef(t, messageIdByTurnId))
  const primaryTurnRefs = turnRefs
    .filter(t => t.stage === 'direct_response' || t.stage === 'opening_position')
    .map(t => t.turnId)
  const challenge = turnRefs.find(t => t.stage === 'red_team_challenge')
  const revisions = turnRefs.filter(t => t.stage === 'revision_or_stand_firm').map(t => t.turnId)
  const synthesis = turnRefs.find(t => t.stage === 'council_synthesis')
  const failedSeats = [
    ...(session.pipeline?.failed_seats ?? []),
    ...turnRefs
      .filter(t => t.completionStatus === 'failed' || t.completionStatus === 'timed_out' || t.completionStatus === 'unavailable')
      .map(t => t.seatId),
  ]
  const uniqueFailed = Array.from(new Set(failedSeats))
  const roster = Array.from(new Set(turnRefs.map(t => t.seatId)))
  const evidenceRefs = mergeEvidenceRefs(session, roundId, priorIntelligence)
  const providerRuntimeTruth = turnRefs.map(t => t.provider)
  const degradedReasons = buildDegradedReasons(session, outcome)
  const messageIds = turnRefs
    .map(t => t.messageId)
    .filter((id): id is string => Boolean(id))

  const base: DurableDeliberationRound = {
    roundId,
    conversationId: convId,
    deliberationSessionId: session.session_id,
    commanderTurnId: session.commander_turn_id,
    commanderRequest: clampText(session.commander_message, MAX_OBJECTIVE_CHARS) ?? session.commander_message.slice(0, MAX_OBJECTIVE_CHARS),
    createdAt: session.turns[0]?.started_at ?? new Date().toISOString(),
    completedAt: synthesis?.completionStatus === 'complete'
      ? session.turns.find(t => t.turn_id === synthesis.turnId)?.completed_at ?? new Date().toISOString()
      : new Date().toISOString(),
    pipelineVersion: session.pipeline?.schema_version ?? session.schema_version,
    outcome,
    roster,
    turnRefs,
    primaryTurnRefs,
    challengeTurnRef: challenge?.turnId ?? null,
    revisionTurnRefs: revisions,
    synthesisTurnRef: synthesis?.turnId ?? session.synthesis_turn_id,
    evidenceRefs,
    providerRuntimeTruth,
    failedSeats: uniqueFailed,
    degradedReasons,
    continuationContext: {
      previousObjective: null,
      previousOutcome: null,
      previousSynthesisSummary: null,
      unresolvedQuestions: [],
      authoritativeContributionSummaries: [],
      evidenceIds: [],
      failedSeats: [],
      degradedReasons: [],
    },
    messageIds,
    babyPresent: roster.includes('baby'),
  }
  base.continuationContext = buildContinuationContextFromRound(base)
  return base
}

export function appendRoundToIntelligence(
  prior: CouncilSessionIntelligenceV1 | null | undefined,
  round: DurableDeliberationRound,
  opts?: { boundCache?: boolean },
): CouncilSessionIntelligenceV1 {
  const existingRounds = prior?.rounds ?? []
  const already = existingRounds.findIndex(r => r.roundId === round.roundId)
  let rounds: DurableDeliberationRound[]
  if (already >= 0) {
    // Idempotent write of the same roundId — replace that slot only; never mutate earlier rounds.
    rounds = existingRounds.map((r, i) => (i === already ? round : r))
  } else {
    rounds = [...existingRounds, round]
  }

  // Conversation-metadata cache only: drop oldest when exceeding MAX_DURABLE_ROUNDS.
  // Message-level councilDeliberationRound records remain the unbounded authority.
  const boundCache = opts?.boundCache !== false
  if (boundCache && rounds.length > MAX_DURABLE_ROUNDS) {
    rounds = rounds.slice(rounds.length - MAX_DURABLE_ROUNDS)
  }

  return {
    version: COUNCIL_SESSION_INTELLIGENCE_VERSION,
    conversationId: round.conversationId,
    latestRoundId: round.roundId,
    roundCount: rounds.length,
    rounds,
    sessionDigest: buildSessionDigest(rounds),
    updatedAt: new Date().toISOString(),
    revision: (prior?.revision ?? 0) + 1,
  }
}

/** Pure in-memory append used by validations and client-side optimistic state. */
export function mergeRoundIntoIntelligence(
  prior: CouncilSessionIntelligenceV1 | null | undefined,
  session: DeliberationSession,
  conversationId: string,
  opts?: { messageIdByTurnId?: Record<string, string>; interrupted?: boolean },
): CouncilSessionIntelligenceV1 {
  const round = buildDurableRoundSnapshot({
    conversationId,
    session,
    messageIdByTurnId: opts?.messageIdByTurnId,
    priorIntelligence: prior,
    interrupted: opts?.interrupted,
  })
  return appendRoundToIntelligence(prior, round)
}

/** Detect forbidden hidden-reasoning fields in a durable payload. */
export const FORBIDDEN_COT_KEYS = [
  'chainOfThought',
  'chain_of_thought',
  'hiddenReasoning',
  'hidden_reasoning',
  'privateThoughts',
  'scratchpad',
  'raw_logits',
] as const

export function payloadContainsHiddenCot(value: unknown, depth = 0): boolean {
  if (depth > 8 || value == null) return false
  if (Array.isArray(value)) return value.some(v => payloadContainsHiddenCot(v, depth + 1))
  if (typeof value !== 'object') return false
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_COT_KEYS as readonly string[]).includes(k)) return true
    if (payloadContainsHiddenCot(v, depth + 1)) return true
  }
  return false
}
