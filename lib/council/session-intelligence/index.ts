export type {
  BuildRoundSnapshotInput,
  CouncilDeliberationRoundV1,
  CouncilMessageIntelligenceMetadata,
  CouncilSessionContinuationContextV1,
  CouncilSessionIntelligenceIndexV1,
  CouncilSessionIntelligenceV1,
  DurableContinuationContext,
  DurableDeliberationRound,
  DurableEvidenceRef,
  DurableProviderRuntimeTruth,
  DurableSessionDigest,
  DurableTurnRef,
  SessionRoundOutcome,
} from './types'

export {
  COUNCIL_DELIBERATION_ROUND_METADATA_KEY,
  COUNCIL_SESSION_INTELLIGENCE_VERSION,
  MAX_DIGEST_CHARS,
  MAX_DURABLE_ROUNDS,
  MAX_METADATA_TURN_CHARS,
  MAX_OBJECTIVE_CHARS,
  MAX_TURN_SUMMARY_CHARS,
} from './types'

export { SESSION_INTELLIGENCE_IDENTITY_DOC } from './identity'

export {
  CONTINUATION_BLOCK_SOFT_MAX,
  MAX_EVIDENCE_REFS_PER_ROUND,
  MAX_ROSTER_SEATS,
  MAX_TURN_REFS,
  measureSerializedSize,
  ROUND_SERIALIZED_HARD_MAX,
  ROUND_SERIALIZED_SOFT_MAX,
  SESSION_INDEX_SOFT_MAX,
} from './bounds'

export {
  appendRoundToIntelligence,
  buildContinuationContextFromRound,
  buildDurableRoundSnapshot,
  buildProviderTruth,
  buildSessionDigest,
  clampText,
  FORBIDDEN_COT_KEYS,
  mergeRoundIntoIntelligence,
  payloadContainsHiddenCot,
  resolveConversationId,
  resolveRoundId,
} from './snapshot'

export {
  embedSessionIntelligenceInMetadata,
  parseSessionIntelligence,
  readSessionIntelligenceFromMetadata,
} from './parse'

export {
  buildSessionIntelligenceIndex,
  extractMessageIntelligence,
  findRound,
  findTurnRef,
  hydrateSessionIntelligenceFromConversation,
  messageMetadataFromTurn,
  parseDurableRoundFromMessageMetadata,
  rebuildIntelligenceFromMessages,
  turnRefToHydratedTurnSkeleton,
} from './hydrate'

export {
  assertSameConversationContinuation,
  buildContinuationPromptBlock,
  continuationAllowsNewRound,
  summarizeContinuationContext,
} from './continuation'

// Server-only persist is NOT re-exported from the barrel — import from
// '@/lib/council/session-intelligence/persist' in server modules only.
