/**
 * Barrel for runtime integrity types + mappers + diagnostic logging helpers.
 */
export type {
  DeploymentIntegrityRollup,
  InternetLayerRollup,
  OverallStatus,
  PersistenceRollup,
  PersistenceTableProbeStatus,
  ProviderIntegritySlot,
  RuntimeHealthRollup,
  RuntimeIntegrityResponse,
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

export { insertDiagnosticEvent, type WarRoomRuntimeIntegrityLogRow } from '@/lib/runtime/diagnosticLog'
