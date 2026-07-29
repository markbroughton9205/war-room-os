import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { CouncilResolutionSessionState } from '@/lib/council/sessionLifecycle'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

export type CouncilPacketStatus = 'idle' | 'gathering' | 'finalizing' | 'released'

export type CouncilProviderRuntimeStates = Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>

export type CouncilProviderRuntimeDetails = Partial<Record<CouncilOrchestrationFamily, string>>

export type CouncilRenderPacketFamily = {
  family: CouncilOrchestrationFamily
  content: string
  integrityWarnings?: string[]
  moderatorWarnings?: string[]
}

export type CouncilRenderPacket = {
  families: CouncilRenderPacketFamily[]
  mode: CouncilCommand['mode']
  sessionState: CouncilResolutionSessionState
  packetStatus: CouncilPacketStatus
  warnings: string[]
  participatingFamilies: CouncilOrchestrationFamily[]
  /** Per-family outcome for the last gather wave (badges / footer). */
  providerRuntimeStates?: CouncilProviderRuntimeStates
  /** Disambiguates SKIPPED (e.g. preflight_unavailable) for provider-issue UI. */
  providerRuntimeDetails?: CouncilProviderRuntimeDetails
  /** Full roster targeted for this operation round — lets the UI distinguish "not called this
   * round" from "responded" without guessing, and gives an honest denominator for response-progress
   * counts ("3 of 5 responded"). Absent means the roster for this packet isn't known. */
  directedFamilies?: CouncilOrchestrationFamily[]
}

export function buildCouncilRenderPacket(args: {
  command: CouncilCommand
  sessionState: CouncilResolutionSessionState
  packetStatus: CouncilPacketStatus
  families: CouncilRenderPacketFamily[]
  extraWarnings?: string[]
  providerRuntimeStates?: CouncilProviderRuntimeStates
  providerRuntimeDetails?: CouncilProviderRuntimeDetails
  directedFamilies?: CouncilOrchestrationFamily[]
}): CouncilRenderPacket {
  const participatingFamilies = args.families.map(f => f.family)
  const warnings = [
    ...(args.extraWarnings ?? []),
    ...args.families.flatMap(f => [...(f.integrityWarnings ?? []), ...(f.moderatorWarnings ?? [])]),
  ]
  return {
    families: args.families,
    mode: args.command.mode,
    sessionState: args.sessionState,
    packetStatus: args.packetStatus,
    warnings: [...new Set(warnings)],
    participatingFamilies,
    ...(args.providerRuntimeStates ? { providerRuntimeStates: args.providerRuntimeStates } : {}),
    ...(args.providerRuntimeDetails ? { providerRuntimeDetails: args.providerRuntimeDetails } : {}),
    ...(args.directedFamilies ? { directedFamilies: args.directedFamilies } : {}),
  }
}
