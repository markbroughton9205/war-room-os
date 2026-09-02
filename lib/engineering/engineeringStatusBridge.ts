import { listEngineeringAgents, type EngineeringAgentRegistryEntry } from './engineeringAgentRegistry'
import { CODEX_ENGINEERING_AGENT } from './codexEngineeringAgent'
import type { EngineeringTaskPacket } from './engineeringTaskPacket'

export type EngineeringStatusBridge = {
  agents: EngineeringAgentRegistryEntry[]
  cursor: {
    status: 'available/manual'
    repoAccessLevel: 'manual workspace'
    approvalRequired: true
  }
  codex: {
    status: 'cloud provider only'
    missingConfiguration: string
  }
  latestTaskPacket: EngineeringTaskPacket | null
  lastValidationResult: string
  rollbackStatus: string
  approvalRequirement: string
}

export function buildEngineeringStatusBridge(input: {
  latestTaskPacket: EngineeringTaskPacket | null
}): EngineeringStatusBridge {
  return {
    agents: listEngineeringAgents(),
    cursor: {
      status: 'available/manual',
      repoAccessLevel: 'manual workspace',
      approvalRequired: true,
    },
    codex: {
      status: 'cloud provider only',
      missingConfiguration: CODEX_ENGINEERING_AGENT.missingConfiguration,
    },
    latestTaskPacket: input.latestTaskPacket,
    lastValidationResult: input.latestTaskPacket ? 'pending Commander-approved execution' : 'none',
    rollbackStatus: input.latestTaskPacket ? input.latestTaskPacket.rollbackRecommendation : 'manual checkpoint required before changes',
    approvalRequirement: 'Commander approval required before execution, file mutation, commit, push, deploy, or delete.',
  }
}
