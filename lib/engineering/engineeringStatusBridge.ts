import type { LocalAgentBridgeStatusResponse, LocalFamilyAgentsResponse } from '@/lib/local-agent/types'
import { listEngineeringAgents, type EngineeringAgentRegistryEntry } from './engineeringAgentRegistry'
import type { EngineeringTaskPacket } from './engineeringTaskPacket'

export type EngineeringStatusBridge = {
  agents: EngineeringAgentRegistryEntry[]
  cursor: {
    status: 'available/manual'
    repoAccessLevel: 'manual workspace'
    approvalRequired: true
  }
  codex: {
    status: 'not connected'
    missingConfiguration: string
  }
  localBridge: {
    status: 'detected' | 'configured' | 'unavailable'
    selectedEngine: string | null
    repoAccessLevel: string
  }
  localModels: {
    status: 'functional' | 'detected' | 'unavailable'
    functionalCount: number
    detectedCount: number
  }
  latestTaskPacket: EngineeringTaskPacket | null
  lastValidationResult: string
  rollbackStatus: string
  approvalRequirement: string
}

export function buildEngineeringStatusBridge(input: {
  localBridge: LocalAgentBridgeStatusResponse
  localFamilies: LocalFamilyAgentsResponse
  latestTaskPacket: EngineeringTaskPacket | null
}): EngineeringStatusBridge {
  const functionalLocalModels = input.localFamilies.familyAgents.filter(agent => agent.functional).length
  const detectedLocalModels = input.localFamilies.familyAgents.filter(agent => agent.detected).length
  const localBridgeStatus =
    input.localBridge.bridge === 'online'
      ? 'detected'
      : input.localBridge.selectedEngine
        ? 'configured'
        : 'unavailable'

  return {
    agents: listEngineeringAgents(),
    cursor: {
      status: 'available/manual',
      repoAccessLevel: 'manual workspace',
      approvalRequired: true,
    },
    codex: {
      status: 'not connected',
      missingConfiguration: 'Codex provider/bridge not configured.',
    },
    localBridge: {
      status: localBridgeStatus,
      selectedEngine: input.localBridge.selectedEngine,
      repoAccessLevel: input.localBridge.repoAccessStatus,
    },
    localModels: {
      status: functionalLocalModels > 0 ? 'functional' : detectedLocalModels > 0 ? 'detected' : 'unavailable',
      functionalCount: functionalLocalModels,
      detectedCount: detectedLocalModels,
    },
    latestTaskPacket: input.latestTaskPacket,
    lastValidationResult: input.latestTaskPacket ? 'pending Commander-approved execution' : 'none',
    rollbackStatus: input.latestTaskPacket ? input.latestTaskPacket.rollbackRecommendation : input.localBridge.rollbackCheckpointStatus,
    approvalRequirement: 'Commander approval required before execution, file mutation, commit, push, deploy, or delete.',
  }
}
