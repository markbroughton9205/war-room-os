/**
 * Minimal Stable Council Mode — isolates shared orchestration from provider calls.
 *
 * ## Layer re-enable test plan (enable one layer at a time; keep COUNCIL_STABILITY_MODE=true until stable)
 *
 * A. Direct provider only — `GET|POST /api/providers/direct-test` (no council middleware)
 * B. Council routing — `/api/chat` with stability on; verify family selection only
 * C. Safe render — enable `applyCouncilRenderGate` + `toDisplayText` formatters only
 * D. Persistence — `tryPersistMemoryProposalFromModelOutput` + safe message persistence
 * E. Memory — `buildProviderMemoryInjection` / council-memory bridge
 * F. Federation — RSS / `buildGrokRssIntelligenceAugment` / signal router context
 * G. Observer — Baby observer hooks + cognitive bus registration
 * H. Repair packet — `isCouncilMessageRepairPacketEligible` + repair API
 * I. Synthesis / compression — `compressCouncilOutput`, opportunity mandate, integrity orchestration
 *
 * Set `COUNCIL_STABILITY_MODE=false` only after all layers pass on mobile + desktop.
 */

export const COUNCIL_STABILITY_ENV = 'COUNCIL_STABILITY_MODE'

export const COUNCIL_STABILITY_FAILURE_MESSAGE =
  'Council stability issue detected. Diagnostics saved.'

export type StabilityModeFlags = {
  memoryInjection: boolean
  rssFederationContext: boolean
  opportunityScanning: boolean
  babyObserverUpdates: boolean
  repairPacketEligibility: boolean
  synthesisCompression: boolean
  packetClassification: boolean
  nonessentialRuntimeMetadata: boolean
  autonomousGatherPaths: boolean
  integrityOrchestrationRetries: boolean
  responseGovernor: boolean
  liveResearchRouter: boolean
  osSweepAndResearchTeam: boolean
}

const DISABLED_WHEN_STABLE: StabilityModeFlags = {
  memoryInjection: false,
  rssFederationContext: false,
  opportunityScanning: false,
  babyObserverUpdates: false,
  repairPacketEligibility: false,
  synthesisCompression: false,
  packetClassification: false,
  nonessentialRuntimeMetadata: false,
  autonomousGatherPaths: false,
  integrityOrchestrationRetries: false,
  responseGovernor: false,
  liveResearchRouter: false,
  osSweepAndResearchTeam: false,
}

const ENABLED_WHEN_NORMAL: StabilityModeFlags = {
  memoryInjection: true,
  rssFederationContext: true,
  opportunityScanning: true,
  babyObserverUpdates: true,
  repairPacketEligibility: true,
  synthesisCompression: true,
  packetClassification: true,
  nonessentialRuntimeMetadata: true,
  autonomousGatherPaths: true,
  integrityOrchestrationRetries: true,
  responseGovernor: true,
  liveResearchRouter: true,
  osSweepAndResearchTeam: true,
}

/** Read `COUNCIL_STABILITY_MODE` from env (`true` enables minimal stable council). */
export function isCouncilStabilityMode(): boolean {
  const raw = process.env[COUNCIL_STABILITY_ENV]
  return raw === 'true' || raw === '1'
}

/** Feature flags for the active mode (disabled layers are off when stability mode is on). */
export function getStabilityModeFlags(): StabilityModeFlags {
  return isCouncilStabilityMode() ? DISABLED_WHEN_STABLE : ENABLED_WHEN_NORMAL
}

export function stabilityModeResponseMeta(): { councilStabilityMode: boolean; stabilityFlags: StabilityModeFlags } {
  return {
    councilStabilityMode: isCouncilStabilityMode(),
    stabilityFlags: getStabilityModeFlags(),
  }
}
