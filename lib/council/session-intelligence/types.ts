/**
 * #17 Council Session Intelligence — durable round provenance on existing
 * war_room_conversations / war_room_messages metadata jsonb columns.
 *
 * Identity (canonical):
 * - conversationId = war_room_conversations.id (durable Council conversation)
 * - roundId = DeliberationSession.round_id (= councilLogicalRequestId)
 * - deliberationSessionId = DeliberationSession.session_id (today == conversationId)
 * - turnId = DeliberationTurn.turn_id (execution provenance; may differ from message row id)
 * - messageId = war_room_messages.id when dual-written
 *
 * Browser CouncilPersistedV1.sessionId is local orchestration only — never a DB FK.
 */

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type {
  DeliberationCompletionStatus,
  DeliberationSession,
  DeliberationTurnRole,
} from '@/lib/council/family-deliberation/types'
import type { DeliberationPipelineOutcome } from '@/lib/council/family-deliberation/stageContract'

export const COUNCIL_SESSION_INTELLIGENCE_VERSION = '17.session-intelligence.v1' as const

/** Metadata key on the durable FINAL Council/AURORA (or failure) message — authoritative round record. */
export const COUNCIL_DELIBERATION_ROUND_METADATA_KEY = 'councilDeliberationRound' as const

export const MAX_DURABLE_ROUNDS = 40
export const MAX_DIGEST_CHARS = 2_400
export const MAX_OBJECTIVE_CHARS = 400
export const MAX_CONCLUSION_CHARS = 600
export const MAX_QUESTION_CHARS = 240
export const MAX_TURN_SUMMARY_CHARS = 280
export const MAX_METADATA_TURN_CHARS = 320

export type SessionRoundOutcome = DeliberationPipelineOutcome | 'INTERRUPTED'

export type DurableProviderRuntimeTruth = {
  seatId: CouncilOrchestrationFamily
  nebulaId: string | null
  reasoningRole: string | null
  providerLabel: string
  providerModel: string | null
  backendType: 'LOCAL' | 'EXTERNAL' | null
  backendProvider: string | null
  backendRuntime: string | null
  completionStatus: DeliberationCompletionStatus
  fallbackFrom: 'LOCAL' | 'EXTERNAL' | null
}

export type DurableEvidenceRef = {
  evidenceId: string
  label: string
  sourceKind: string
  url: string | null
  originType: string | null
  /** Freshness observed when this round first recorded the evidence (historical truth). */
  observedFreshness: string | null
  firstIntroducedRoundId: string
  reusedInRoundIds: string[]
}

export type DurableTurnRef = {
  turnId: string
  messageId: string | null
  seatId: CouncilOrchestrationFamily
  nebulaId: string | null
  reasoningRole: string | null
  stage: DeliberationTurnRole
  completionStatus: DeliberationCompletionStatus
  challengeTargetIds: string[]
  revisionOfTurnId: string | null
  revisionDecision: 'REVISE' | 'STAND_FIRM' | null
  evidenceIds: string[]
  provider: DurableProviderRuntimeTruth
  /** Bounded observable summary — never hidden CoT. */
  summary: string | null
}

export type DurableContinuationContext = {
  previousObjective: string | null
  previousOutcome: SessionRoundOutcome | null
  previousSynthesisSummary: string | null
  unresolvedQuestions: string[]
  authoritativeContributionSummaries: string[]
  evidenceIds: string[]
  failedSeats: CouncilOrchestrationFamily[]
  degradedReasons: string[]
}

export type DurableSessionDigest = {
  currentObjective: string | null
  establishedConclusions: string[]
  unresolvedQuestions: string[]
  activeEvidenceIds: string[]
  latestOutcome: SessionRoundOutcome | null
  lastSynthesis: string | null
  followUpState: 'idle' | 'awaiting_commander' | 'ready_to_continue'
}

export type DurableDeliberationRound = {
  roundId: string
  conversationId: string
  deliberationSessionId: string
  commanderTurnId: string
  commanderRequest: string
  createdAt: string
  completedAt: string | null
  pipelineVersion: string
  outcome: SessionRoundOutcome
  roster: CouncilOrchestrationFamily[]
  turnRefs: DurableTurnRef[]
  primaryTurnRefs: string[]
  challengeTurnRef: string | null
  revisionTurnRefs: string[]
  synthesisTurnRef: string | null
  evidenceRefs: DurableEvidenceRef[]
  providerRuntimeTruth: DurableProviderRuntimeTruth[]
  failedSeats: CouncilOrchestrationFamily[]
  degradedReasons: string[]
  continuationContext: DurableContinuationContext
  messageIds: string[]
  babyPresent: boolean
}

export type CouncilSessionIntelligenceV1 = {
  version: typeof COUNCIL_SESSION_INTELLIGENCE_VERSION
  conversationId: string
  latestRoundId: string | null
  roundCount: number
  /** Rebuildable cache — authoritative copy also lives on final message metadata. */
  rounds: DurableDeliberationRound[]
  sessionDigest: DurableSessionDigest
  updatedAt: string
  /** Monotonic merge counter for concurrent append protection. */
  revision: number
}

/** Spec alias — authoritative per-round durable record. */
export type CouncilDeliberationRoundV1 = DurableDeliberationRound

/** Spec alias — bounded follow-up packet built from prior durable rounds. */
export type CouncilSessionContinuationContextV1 = DurableContinuationContext

/**
 * Slim conversation-level index (rebuildable from message round records).
 * Not the sole authoritative history — DurableDeliberationRound on messages is.
 */
export type CouncilSessionIntelligenceIndexV1 = {
  version: typeof COUNCIL_SESSION_INTELLIGENCE_VERSION
  conversationId: string
  latestRoundId: string | null
  roundCount: number
  latestOutcome: SessionRoundOutcome | null
  latestSynthesisMessageId: string | null
  updatedAt: string
  revision: number
  digest: DurableSessionDigest
}

/** Slim message metadata written onto war_room_messages.metadata for Council turns. */
export type CouncilMessageIntelligenceMetadata = {
  conversationId?: string
  roundId?: string
  turnId?: string
  seatId?: CouncilOrchestrationFamily
  nebulaId?: string | null
  reasoningRole?: string | null
  stage?: DeliberationTurnRole | string
  councilStage?: string
  roundRequestId?: string
  commanderTurnId?: string
  deliberationSessionId?: string
  providerLabel?: string
  providerModel?: string | null
  backendType?: 'LOCAL' | 'EXTERNAL' | null
  backendProvider?: string | null
  backendRuntime?: string | null
  evidenceIds?: string[]
  challengeTargetIds?: string[]
  revisionTargetId?: string | null
  revisionDecision?: 'REVISE' | 'STAND_FIRM' | null
  pipelineOutcome?: SessionRoundOutcome | null
  /** Bounded turn summary only — full transcript stays in message content. */
  turnSummary?: string | null
}

export type BuildRoundSnapshotInput = {
  conversationId: string
  session: DeliberationSession
  messageIdByTurnId?: Record<string, string>
  priorIntelligence?: CouncilSessionIntelligenceV1 | null
  interrupted?: boolean
}
