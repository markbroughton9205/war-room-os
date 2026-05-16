/**
 * Barrel for runtime integrity types + mappers + diagnostic logging helpers.
 */
export type {
  DeploymentIntegrityRollup,
  EvidenceSeverity,
  InternetLayerRollup,
  OverallStatus,
  PersistenceRollup,
  PersistenceTableProbeStatus,
  ProviderIntegritySlot,
  RuntimeContradiction,
  RuntimeHealthRollup,
  RuntimeIntegrityFailureView,
  RuntimeIntegrityLiveVerifiedItem,
  RuntimeIntegrityResponse,
  RuntimeIntegrityWarningView,
  SubsystemOperationalStatus,
  SubsystemRow,
  SubsystemSource,
  ToolLayerClassification,
  ToolsLayerRollup,
  TruthLevel,
} from '@/lib/runtime/runtimeIntegrityTypes'

export {
  buildDeploymentIntegrityRollup,
  buildInternetRollupFromInternetStatusJson,
  buildPersistenceRollup,
  buildProviderIntegritySlots,
  buildRuntimeHealthRollup,
  buildToolsLayerRollup,
  computeOverallStatus,
  mapActionQueueProbe,
  mapConversationsProbe,
  mapDeployStatusJson,
  mapEngineControlJson,
  mapInternetStatusJson,
  mapLocalAgentJson,
  mapMemoryProbe,
  mapOrchestrationState,
  mapProvidersHealthJson,
  mapRedSentinelJson,
  mapRedTeamCoderJson,
} from '@/lib/runtime/runtimeIntegrityMapper'

export { collectRuntimeIntegrity, collectRuntimeIntegrityPartial } from '@/lib/runtime/runtimeIntegrityCollect'
export { finalizeRuntimeIntegrityResponse, type RuntimeIntegrityPartial } from '@/lib/runtime/finalizeRuntimeIntegrityResponse'
export {
  applySubsystemEvidenceSeverities,
  computeOverallStatusWeighted,
  evidenceSeverityForSubsystemId,
} from '@/lib/runtime/runtimeEvidenceWeighting'
export {
  dedupeRuntimeContradictions,
  detectProviderHintVsEngineProbeContradictions,
  detectProviderSlotVsGatherContradictions,
} from '@/lib/runtime/runtimeContradiction'
export {
  buildRuntimeDiagnosticGroundingBlock,
  buildRuntimeEvidencePacket,
  type RuntimeEvidencePacket,
} from '@/lib/runtime/runtimeEvidencePacket'
export {
  isRuntimeIntegritySnapshotStale,
  parseRuntimeIntegrityGeneratedAt,
  tryParseRuntimeIntegrityPartial,
  RUNTIME_INTEGRITY_SNAPSHOT_MAX_AGE_MS,
} from '@/lib/runtime/runtimeIntegritySnapshot'

export { insertDiagnosticEvent, type WarRoomRuntimeIntegrityLogRow } from '@/lib/runtime/diagnosticLog'
