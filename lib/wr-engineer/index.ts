/**
 * WR-Engineer public surface (Phase 1 foundation).
 *
 * War Room's sovereign engineering agent shell. See lib/wr-engineer/identity/IDENTITY.md for who
 * WR-Engineer is, SOUL.md for how it behaves, and USER.md for who it serves. See this directory's
 * individual module headers for what existing War Room infrastructure each capability delegates to
 * — WR-Engineer introduces no parallel filesystem-write path, process-execution path, or
 * git-access path; it reuses lib/native-builder, lib/mission-runtime, and lib/repo throughout.
 */
export {
  loadIdentityStack,
  loadIdentityLayer,
  stackToOrderedText,
  IDENTITY_LAYER_ORDER,
  type IdentityLayerName,
  type IdentityLayer,
  type IdentityStack,
} from './identity/loader'

export {
  AGENT_STATES,
  AGENT_STATE_TRANSITIONS,
  type AgentState,
  type AgentStateHistoryEntry,
  EPISTEMIC_STATUSES,
  isEpistemicStatus,
  type EpistemicStatus,
  type MissionContext,
  type MissionAcceptanceCriterion,
  type ModelAdapter,
  type ModelAdapterRequest,
  type ModelAdapterResult,
  ENGINEERING_MEMORY_CATEGORIES,
  type EngineeringMemoryCategory,
} from './types'

export {
  createAgentStateMachine,
  transitionAgentState,
  canTransition,
  InvalidAgentStateTransitionError,
  type AgentStateMachine,
} from './agentState'

export {
  createMissionContext,
  markCriterionMet,
  allCriteriaMet,
  resolveMission,
  type CreateMissionInput,
} from './missionContext'

export { CouncilProviderModelAdapter, UnavailableLocalModelAdapter } from './modelAdapter'
export { LocalWrEngineerModelAdapter } from './localModelAdapter'
export { WrEngineerModelRouter, createWrEngineerChatAdapter } from './modelRouter'

export * as wrEngineerReadSurface from './readSurface'
export * as wrEngineerValidation from './validation'

export {
  proposeEdit,
  WR_ENGINEER_CANNOT_WRITE_FILES,
  type ProposeEditInput,
  type WrEngineerEditProposal,
} from './codeEditProposals'

export {
  ENGINEERING_MEMORY_CATEGORIES as MEMORY_CATEGORIES,
  type EngineeringMemoryRecord,
  type CreateMemoryRecordInput,
  type MemoryQuery,
  type EngineeringMemoryStore,
} from './memory/types'
export { JsonFileEngineeringMemoryStore, engineeringMemory } from './memory/store'

export {
  WrEngineerRuntime,
  WrEngineerNotInitializedError,
  WrEngineerNoActiveMissionError,
} from './runtime'

// ---------------------------------------------------------------------------
// Phase 2: remote node, pairing, protocol, sessions, Native Builder bridge.
// ---------------------------------------------------------------------------

export * as wrEngineerNodeTypes from './node/types'
export { JsonFileNodeStore, wrEngineerNodeStore, type NodeStore } from './node/store'
export {
  generatePairingCode,
  requestPairing,
  authorizePairing,
  rejectPairing,
  sweepExpiredPairingTokens,
  PairingError,
  DEFAULT_PAIRING_TTL_MS,
} from './node/pairing'
export {
  authenticateNode,
  recordHeartbeat,
  getNodeConnectionStatus,
  revokeNode,
  rotateNodeCredential,
} from './node/identity'
export {
  registerRepository,
  listRepositoriesForNode,
  applyRepositoryStatusReport,
  requireBoundRepository,
  RepositoryRegistrationError,
} from './node/repository'
export * as wrEngineerProtocol from './node/protocol'

export * as wrEngineerSessionTypes from './session/types'
export { JsonFileSessionStore, wrEngineerSessionStore, type SessionStore } from './session/store'
export {
  createSession,
  setSessionAgentState,
  setSessionTurnPhase,
  saveTurnEvidence,
  assembleSessionContext,
  sendCommanderMessage,
  recordToolActivity,
  SessionBindingError,
} from './session/session'

export { logWrEngineerAudit } from './audit'

export {
  bridgeProposalToNativeBuilder,
  WR_ENGINEER_BRIDGE_NEVER_APPLIES,
  type BridgeOutcome,
  type BridgeRejectionReason,
  type BridgeIssueMeta,
} from './nativeBuilderBridge'

// ---------------------------------------------------------------------------
// Phase 3: chat-driven proposal generation, session-scoped validation, live SSE stream.
// ---------------------------------------------------------------------------

export {
  parseStructuredModelResponse,
  STRUCTURED_RESPONSE_INSTRUCTIONS,
  type ModelProposal,
  type ModelProposedChange,
  type ModelProposedPatch,
  type StructuredModelResponse,
  type StructuredResponseParseResult,
} from './structuredResponse'

export {
  validateProposedChangeShapes,
  sessionRepositoryMatchesServerWorkspace,
  type ProposalValidationResult,
} from './proposalValidation'

export { sendEngineeringChatMessage, sendInspectingEngineeringChatMessage, type EngineeringChatResult, type ProposalOutcome } from './engineeringChat'

export {
  PROPOSAL_STATES,
  STORED_PROPOSAL_STATES,
  type ProposalState,
  type StoredProposalState,
} from './session/types'
export { deriveProposalState, proposalStateFromRepairState, isStoredProposalState } from './session/proposalState'
export {
  setProposalGenerating,
  setProposalReady,
  setProposalInvalid,
  setProposalBridged,
} from './session/session'

export {
  WR_ENGINEER_STREAM_VERSION,
  encodeWrEngineerStreamEnvelope,
  encodeWrEngineerStreamComment,
  snapshotToBaseline,
  computeStreamDeltas,
  type WrEngineerStreamEnvelope,
  type WrEngineerStreamEnvelopeType,
  type WrEngineerSessionSnapshot,
  type StreamBaseline,
  type StreamDeltaResult,
} from './sessionStream'

// ---------------------------------------------------------------------------
// Phase 4: inspect-before-propose tool loop, current-turn evidence, proposal grounding.
// ---------------------------------------------------------------------------

export {
  INSPECT_TOOL_NAMES,
  parseInspectTurnResponse,
  wrapInspectToolRequest,
  INSPECT_TURN_INSTRUCTIONS,
  type InspectToolName,
  type InspectTurnParseResult,
} from './inspectContract'

export {
  INSPECT_BOUNDS,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_FILES_READ_PER_TURN,
  MAX_SEARCH_RESULTS,
  MAX_FILE_BYTES_PER_READ,
  MAX_TOTAL_CONTEXT_BYTES,
} from './inspectBounds'

export {
  createTurnEvidence,
  compactTurnEvidence,
  groundProposalAgainstTurn,
  TARGET_NOT_READ_THIS_TURN,
  MATCH_TEXT_NOT_OBSERVED,
  MATCH_TEXT_NOT_UNIQUE,
  CREATE_FILE_CONTEXT_NOT_INSPECTED,
  type EngineeringTurnEvidence,
  type CompactTurnEvidence,
  type ProposalFileGrounding,
  type TurnPhase,
} from './turnEvidence'

export { executeInspectTool, resolveInspectExecutionMode } from './inspectTools'
export { runInspectTurnLoop, buildTurnObservationPrompt } from './inspectLoop'

// ---------------------------------------------------------------------------
// Phase 5: local coding engine, Commander engine selection, health dashboard.
// ---------------------------------------------------------------------------

export {
  ENGINE_MODES,
  DEFAULT_ENGINE_MODE,
  DEFAULT_LOCAL_RUNTIME,
  DEFAULT_LOCAL_MODEL,
  RECOMMENDED_LOCAL_MODEL,
  LOCAL_INFERENCE_TIMEOUT_MS,
  type EngineMode,
  type EngineSelection,
  type WrEngineerEngineDashboardState,
  type LocalEngineStatus,
} from './engineTypes'

export { parseEngineSelection, JsonFileEngineSelectionStore, wrEngineerEngineSelectionStore } from './engineSelection'
export { classifyProviderFailure, providerHealthFromFailure } from './providerFailure'
export { boundSystemPrompt } from './localContext'
export { redactEngineEndpoint, probeLocalRuntime, localEngineStatusFromProbe, getLocalEngineTelemetry } from './localEngine'
export { buildEngineDashboardState, dashboardStateIsSecretFree } from './engineHealth'
export { describeLocalEngineStartup, shouldStartOllamaServe } from './localEngineStartup'
