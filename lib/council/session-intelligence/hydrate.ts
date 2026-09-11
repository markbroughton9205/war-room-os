import type { DeliberationTurn } from '@/lib/council/family-deliberation/types'
import { appendRoundToIntelligence, buildSessionDigest } from './snapshot'
import { parseSessionIntelligence, readSessionIntelligenceFromMetadata } from './parse'
import {
  COUNCIL_DELIBERATION_ROUND_METADATA_KEY,
  COUNCIL_SESSION_INTELLIGENCE_VERSION,
  type CouncilMessageIntelligenceMetadata,
  type CouncilSessionIntelligenceIndexV1,
  type CouncilSessionIntelligenceV1,
  type DurableDeliberationRound,
  type DurableTurnRef,
} from './types'

export type HydratedSessionIntelligence = {
  intelligence: CouncilSessionIntelligenceV1
  rounds: DurableDeliberationRound[]
  latestRound: DurableDeliberationRound | null
  /** True when rounds were rebuilt from message metadata (authoritative path). */
  rebuiltFromMessages: boolean
}

export function parseDurableRoundFromMessageMetadata(
  metadata: unknown,
): DurableDeliberationRound | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const raw = (metadata as Record<string, unknown>)[COUNCIL_DELIBERATION_ROUND_METADATA_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const round = raw as DurableDeliberationRound
  if (typeof round.roundId !== 'string' || !round.roundId.trim()) return null
  if (typeof round.conversationId !== 'string' || !round.conversationId.trim()) return null
  if (!Array.isArray(round.turnRefs)) return null
  return round
}

/**
 * Rebuild session intelligence from durable FINAL-message round records.
 * Conversation metadata cache is a fallback / convenience index only.
 */
export function rebuildIntelligenceFromMessages(input: {
  conversationId: string
  messages: Array<{ id?: string; metadata?: unknown }>
  fallbackMetadata?: unknown
}): HydratedSessionIntelligence | null {
  const byId = new Map<string, DurableDeliberationRound>()
  for (const message of input.messages) {
    const round = parseDurableRoundFromMessageMetadata(message.metadata)
    if (!round) continue
    if (round.conversationId !== input.conversationId) continue
    byId.set(round.roundId, round)
  }

  if (byId.size > 0) {
    let intelligence: CouncilSessionIntelligenceV1 | null = null
    // Rebuild from authoritative message records without applying conversation-cache bounds.
    // Conversation metadata may still cache only the newest MAX_DURABLE_ROUNDS.
    const sorted = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const round of sorted) {
      intelligence = appendRoundToIntelligence(intelligence, round, { boundCache: false })
    }
    if (!intelligence) return null
    return {
      intelligence,
      rounds: intelligence.rounds,
      latestRound: intelligence.rounds[intelligence.rounds.length - 1] ?? null,
      rebuiltFromMessages: true,
    }
  }

  return hydrateSessionIntelligenceFromConversation({
    conversationId: input.conversationId,
    metadata: input.fallbackMetadata,
  })
}

export function buildSessionIntelligenceIndex(
  intelligence: CouncilSessionIntelligenceV1,
): CouncilSessionIntelligenceIndexV1 {
  const latest = intelligence.rounds[intelligence.rounds.length - 1] ?? null
  const synthesisTurn = latest?.synthesisTurnRef
    ? latest.turnRefs.find(t => t.turnId === latest.synthesisTurnRef)
    : null
  return {
    version: COUNCIL_SESSION_INTELLIGENCE_VERSION,
    conversationId: intelligence.conversationId,
    latestRoundId: intelligence.latestRoundId,
    roundCount: intelligence.roundCount,
    latestOutcome: latest?.outcome ?? intelligence.sessionDigest.latestOutcome,
    latestSynthesisMessageId: synthesisTurn?.messageId ?? null,
    updatedAt: intelligence.updatedAt,
    revision: intelligence.revision,
    digest: intelligence.sessionDigest,
  }
}

export function hydrateSessionIntelligenceFromConversation(input: {
  conversationId: string
  metadata: unknown
}): HydratedSessionIntelligence | null {
  const intelligence = readSessionIntelligenceFromMetadata(input.metadata)
  if (!intelligence) return null
  if (intelligence.conversationId !== input.conversationId) {
    return null
  }
  return {
    intelligence,
    rounds: intelligence.rounds,
    latestRound: intelligence.rounds[intelligence.rounds.length - 1] ?? null,
    rebuiltFromMessages: false,
  }
}

export function findRound(
  intelligence: CouncilSessionIntelligenceV1 | null | undefined,
  roundId: string,
): DurableDeliberationRound | null {
  if (!intelligence) return null
  return intelligence.rounds.find(r => r.roundId === roundId) ?? null
}

export function findTurnRef(
  round: DurableDeliberationRound | null | undefined,
  turnId: string,
): DurableTurnRef | null {
  if (!round) return null
  return round.turnRefs.find(t => t.turnId === turnId) ?? null
}

/**
 * Reconstruct a lightweight DeliberationTurn-shaped object for UI from durable refs.
 * Does NOT restore hidden CoT or full transcripts (those live in message content).
 */
export function turnRefToHydratedTurnSkeleton(
  turn: DurableTurnRef,
  round: DurableDeliberationRound,
): Partial<DeliberationTurn> {
  return {
    turn_id: turn.turnId,
    session_id: round.deliberationSessionId,
    round_id: round.roundId,
    commander_turn_id: round.commanderTurnId,
    provider_family: turn.seatId,
    provider_label: turn.provider.providerLabel,
    provider_model: turn.provider.providerModel,
    turn_role: turn.stage,
    completion_status: turn.completionStatus,
    challenge_target_ids: turn.challengeTargetIds,
    revision_of_message_id: turn.revisionOfTurnId,
    revision_decision: turn.revisionDecision,
    evidence_reference_ids: turn.evidenceIds,
    evidence_ids_used: turn.evidenceIds,
    executive_position: turn.summary ?? '',
    full_response: '',
    agent_identity: turn.nebulaId,
    backend_type: turn.provider.backendType,
    backend_provider: turn.provider.backendProvider,
    backend_runtime: turn.provider.backendRuntime,
    fallback_from: turn.provider.fallbackFrom,
    output_message_id: turn.messageId,
  }
}

export function messageMetadataFromTurn(input: {
  conversationId: string
  roundId: string
  turn: DeliberationTurn
  pipelineOutcome?: string | null
  councilStage?: string
  /** Attach authoritative round record on the FINAL durable message only. */
  durableRound?: DurableDeliberationRound | null
}): CouncilMessageIntelligenceMetadata & Record<string, unknown> {
  const { conversationId, roundId, turn, pipelineOutcome, councilStage, durableRound } = input
  const base: CouncilMessageIntelligenceMetadata & Record<string, unknown> = {
    conversationId,
    roundId,
    turnId: turn.turn_id,
    seatId: turn.provider_family,
    nebulaId: turn.agent_identity ?? null,
    reasoningRole: null,
    stage: turn.turn_role,
    councilStage,
    roundRequestId: roundId,
    commanderTurnId: turn.commander_turn_id,
    deliberationSessionId: turn.session_id,
    providerLabel: turn.provider_label,
    providerModel: turn.provider_model,
    backendType: turn.backend_type ?? null,
    backendProvider: turn.backend_provider ?? null,
    backendRuntime: turn.backend_runtime ?? null,
    evidenceIds: [...(turn.evidence_ids_used ?? turn.evidence_reference_ids ?? [])].slice(0, 40),
    challengeTargetIds: [...(turn.challenge_target_ids ?? [])].slice(0, 20),
    revisionTargetId: turn.revision_of_message_id,
    revisionDecision: turn.revision_decision ?? null,
    pipelineOutcome: (pipelineOutcome as CouncilMessageIntelligenceMetadata['pipelineOutcome']) ?? null,
    turnSummary: typeof turn.executive_position === 'string'
      ? turn.executive_position.slice(0, 320)
      : null,
  }
  if (durableRound) {
    base[COUNCIL_DELIBERATION_ROUND_METADATA_KEY] = durableRound
  }
  return base
}

export function extractMessageIntelligence(
  metadata: unknown,
): CouncilMessageIntelligenceMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const m = metadata as Record<string, unknown>
  if (typeof m.roundId !== 'string' && typeof m.roundRequestId !== 'string' && typeof m.turnId !== 'string') {
    return null
  }
  return m as CouncilMessageIntelligenceMetadata
}

export { parseSessionIntelligence, readSessionIntelligenceFromMetadata, buildSessionDigest }
