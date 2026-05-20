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

import type { CouncilFlowMode } from '@/lib/council/councilMode'
import { isStableGroupChatMode } from '@/lib/council/councilMode'

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

/** Heavy systems off when env stability is on or flow is stable group chat. */
export function isMinimalCouncilSystemsPath(councilFlowMode?: CouncilFlowMode | null): boolean {
  return isCouncilStabilityMode() || isStableGroupChatMode(councilFlowMode)
}

/**
 * Pass provider text through without integrity substitution, fallback summaries, or degraded flags.
 * Active for `COUNCIL_STABILITY_MODE` and stable group chat flow.
 */
export function shouldPassthroughCouncilProviderText(councilFlowMode?: CouncilFlowMode | null): boolean {
  return isMinimalCouncilSystemsPath(councilFlowMode)
}

/** Feature flags for the active mode (disabled layers are off when minimal path is active). */
export function getStabilityModeFlags(councilFlowMode?: CouncilFlowMode | null): StabilityModeFlags {
  return isMinimalCouncilSystemsPath(councilFlowMode) ? DISABLED_WHEN_STABLE : ENABLED_WHEN_NORMAL
}

export function stabilityModeResponseMeta(councilFlowMode?: CouncilFlowMode | null): {
  councilStabilityMode: boolean
  councilFlowMode?: CouncilFlowMode
  stabilityFlags: StabilityModeFlags
} {
  return {
    councilStabilityMode: isCouncilStabilityMode(),
    ...(councilFlowMode ? { councilFlowMode } : {}),
    stabilityFlags: getStabilityModeFlags(councilFlowMode),
  }
}

/** Always-on render diagnostic when stability mode is active (no secrets). */
export function logCouncilStabilityRender(args: {
  provider: string
  rawLength: number
  renderedLength: number
  fallbackSkipped: boolean
}): void {
  if (!isCouncilStabilityMode() && !isStableGroupChatMode()) return
  console.log(
    '[council-stability]',
    JSON.stringify({
      provider: args.provider,
      rawLength: args.rawLength,
      renderedLength: args.renderedLength,
      stabilityMode: true,
      fallbackSkipped: args.fallbackSkipped,
    }),
  )
}
