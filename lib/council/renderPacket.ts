import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { CouncilResolutionSessionState } from '@/lib/council/sessionLifecycle'

export type CouncilPacketStatus = 'idle' | 'gathering' | 'finalizing' | 'released'

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
}

export function buildCouncilRenderPacket(args: {
  command: CouncilCommand
  sessionState: CouncilResolutionSessionState
  packetStatus: CouncilPacketStatus
  families: CouncilRenderPacketFamily[]
  extraWarnings?: string[]
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
  }
}
