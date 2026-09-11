/**
 * Shared deliberation semantics between family_to_family_v1 and scout-swarm.
 * This is NOT a merged runtime — only common primitives / shapes.
 */

export {
  parseRevisionDecision,
  revisionStatusFromDecision,
  formatRevisionStageInstruction,
  type RevisionDecision,
  type ChallengeAddressed,
  type ParsedRevisionDecision,
  type RevisionDecisionSource,
} from './revisionDecision'

export {
  evaluateSynthesisGate,
  authoritativePrimaryTurns,
  seatsChallengedByPhoenix,
  derivePipelineOutcome,
  buildPipelineProvenance,
  type SynthesisGateResult,
} from './pipeline'

export {
  type DeliberationStageId,
  type DeliberationStageRecord,
  type DeliberationPipelineOutcome,
  type DeliberationStageProgressCode,
  progressCodeForStage,
  DEFAULT_FAMILY_DELIBERATION_SEQUENCE,
  OPENING_POSITION_POLICY,
  CONTINUATION_POLICY,
} from './stageContract'

/** Scout retains mission/decomposition; family retains simpler roster planning. */
export const FAMILY_SCOUT_CONSOLIDATION = {
  shared: [
    'challenge',
    'cross-review / revision semantics',
    'stage result shape',
    'evidence references',
    'failure truth',
  ],
  notMerged: [
    'scout mission decomposition',
    'scout independence freeze',
    'family intent/round-plan roster',
  ],
} as const
