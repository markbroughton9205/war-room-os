/**
 * Honest Engineer/Foundry overall status + per-capability states. Never hardcoded ONLINE.
 */
import { detectToolchain } from './toolchain'
import { getProjectsRoot } from './workspaceRegistry'
import { listRepairs } from './storage'
import { listAllOwnedProcesses } from './processRegistry'
import { resolveFoundryBrainStatus, type FoundryBrainStatus } from './foundryBrainStatus'
import { resolveLocalCoder } from './localCoder'
import { resolveLocalModelHealth, type LocalModelHealth } from './localModelHealth'
import { readFoundryRuntimeConfig } from './foundryRuntimeConfig'

export type EngineerOverallStatus =
  | 'OFFLINE'
  | 'CONFIG_REQUIRED'
  | 'READY'
  | 'WORKING'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'ERROR'

export type CapabilityState = 'AVAILABLE' | 'CONFIG_REQUIRED' | 'NOT_AVAILABLE'

export type EngineerStatusSnapshot = {
  overall: EngineerOverallStatus
  localExecution: 'LOCAL_EXECUTION_AVAILABLE' | 'LOCAL_EXECUTION_NOT_AVAILABLE'
  remoteExecution: 'REMOTE_EXECUTION_AVAILABLE' | 'REMOTE_EXECUTION_NOT_AVAILABLE'
  foundryModelStatus: {
    localCoder: 'LOCAL_CODER_READY' | 'LOCAL_CODER_UNAVAILABLE'
    hostedCoder: 'HOSTED_CODER_READY' | 'HOSTED_CODER_UNAVAILABLE'
    codingModel: string | null
    generalModel: string | null
    models: string[]
    detail: string
    brain: FoundryBrainStatus
    localModel: LocalModelHealth
    localMissionReliability?: 'VALIDATED' | 'UNPROVEN'
  }
  councilProviderStatus: 'COUNCIL_READY' | 'COUNCIL_DEGRADED'
  projectsRoot: string
  capabilities: Record<string, CapabilityState>
  toolchain: Awaited<ReturnType<typeof detectToolchain>>
  activeMissionCount: number
  ownedProcessCount: number
  generatedAt: string
}

export async function getEngineerStatus(): Promise<EngineerStatusSnapshot> {
  const toolchain = await detectToolchain()
  const node = toolchain.find(t => t.id === 'node')
  const git = toolchain.find(t => t.id === 'git')
  const repairs = await listRepairs().catch(() => [])
  const active = repairs.filter(r => !['resolved', 'cancelled', 'rolled_back'].includes(r.state))
  const waiting = active.some(r => r.state === 'awaiting_local_execution_approval' || r.state === 'awaiting_commander_review')
  const working = active.some(r => ['applying_patch', 'validating', 'planning', 'inspecting_repository'].includes(r.state))
  const blocked = active.some(r => r.state === 'blocked' || r.state === 'verification_failed')
  const reliability = readFoundryRuntimeConfig().localMissionReliability === 'VALIDATED' ? 'VALIDATED' : 'UNPROVEN'
  const [local, brain, localModel] = await Promise.all([
    resolveLocalCoder(),
    resolveFoundryBrainStatus(),
    resolveLocalModelHealth({ tryStart: true }),
  ])

  const usableBrain = localModel.state === 'READY' || (brain.ready && !brain.usageLimited)
  let overall: EngineerOverallStatus = 'READY'
  if (node?.state !== 'AVAILABLE') overall = 'CONFIG_REQUIRED'
  else if (!usableBrain) overall = 'BLOCKED'
  if (working) overall = 'WORKING'
  else if (waiting) overall = 'WAITING_APPROVAL'
  else if (blocked) overall = 'BLOCKED'

  const cap = (state: CapabilityState): CapabilityState => state

  return {
    overall,
    localExecution: node?.state === 'AVAILABLE' ? 'LOCAL_EXECUTION_AVAILABLE' : 'LOCAL_EXECUTION_NOT_AVAILABLE',
    remoteExecution: 'REMOTE_EXECUTION_NOT_AVAILABLE',
    foundryModelStatus: {
      localCoder: local.status,
      hostedCoder: local.hostedStatus,
      codingModel: local.codingModel || brain.configuredModel,
      generalModel: local.generalModel,
      models: local.models,
      detail: localModel.state === 'READY'
        ? `${localModel.detail} Remote: ${brain.detail}`
        : brain.detail,
      brain,
      localModel,
      localMissionReliability: reliability,
    },
    councilProviderStatus: local.hostedStatus === 'HOSTED_CODER_READY' ? 'COUNCIL_READY' : 'COUNCIL_DEGRADED',
    projectsRoot: getProjectsRoot(),
    capabilities: {
      workspace: cap('AVAILABLE'),
      filesystem: cap('AVAILABLE'),
      terminal: cap(node?.state === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_AVAILABLE'),
      gitRead: cap(git?.state === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_AVAILABLE'),
      gitCommit: cap('CONFIG_REQUIRED'),
      gitPush: cap('CONFIG_REQUIRED'),
      deploy: cap('NOT_AVAILABLE'),
      localCoder: cap(localModel.state === 'READY' ? 'AVAILABLE' : 'NOT_AVAILABLE'),
      foundryBrain: cap(usableBrain ? 'AVAILABLE' : 'NOT_AVAILABLE'),
      hostedCoder: cap(local.hostedStatus === 'HOSTED_CODER_READY' ? 'AVAILABLE' : 'CONFIG_REQUIRED'),
      visualVerification: cap('NOT_AVAILABLE'),
    },
    toolchain,
    activeMissionCount: active.length,
    ownedProcessCount: listAllOwnedProcesses().length,
    generatedAt: new Date().toISOString(),
  }
}
