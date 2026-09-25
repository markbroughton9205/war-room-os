/**
 * Public FRK surface. Domain modules stay importable for validation.
 */
export {
  FRK_CAPABILITIES,
  FRK_COMMANDER_GATED_ACTIONS,
  FRK_CURSOR_DEPENDENCY_COUNT,
  FRK_DIRECT_FILESYSTEM_WRITE_COUNT,
  FRK_MAX_STEPS,
  FRK_QWEN_DEPENDENCY_COUNT,
  FRK_SCHEMA_VERSION,
  RAW_CHAIN_OF_THOUGHT_STORED_COUNT,
  UNBOUNDED_REASONING_LOOP_COUNT,
} from './types'
export type {
  FoundryBranchDecision,
  FoundryEvidence,
  FoundryHypothesis,
  FoundryProblemModel,
  FoundryReasoningBrief,
  FoundryReasoningBranch,
  FoundrySearchBudget,
  FoundryReasoningGraph,
  FoundryReasoningSession,
  FoundryReasoningStrategy,
  FoundryReasoningWorkerRequest,
  FoundryReasoningWorkerResponse,
  FoundryVerifiedClaim,
} from './types'
export {
  activeHypothesis,
  addSessionEvidence,
  addSessionHypothesis,
  createFoundryReasoningSession,
  explainSession,
  graphInvariant,
  restoreSession,
  runBoundedSession,
  selectSessionStrategy,
  serializeSession,
} from './orchestrator'
