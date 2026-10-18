/**
 * Deterministic content hashing for sealed Foundry contracts.
 * Volatile fields (status, timestamps, ids used only as row identity, contentHash itself)
 * are excluded from the identity hash.
 */
import { createHash } from 'node:crypto'
import type { FoundryAcceptanceContract, FoundryMissionContract } from './foundryContractTypes'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export function foundryContentHash(material: unknown): string {
  return createHash('sha256').update(canonicalJson(material), 'utf8').digest('hex')
}

export function missionContractIdentityMaterial(contract: Pick<
  FoundryMissionContract,
  | 'schemaVersion'
  | 'missionId'
  | 'projectId'
  | 'workspaceId'
  | 'commanderRequest'
  | 'goal'
  | 'nonGoals'
  | 'constraints'
  | 'specId'
  | 'specVersion'
  | 'taskIds'
  | 'acceptanceContractId'
  | 'authoritySnapshot'
  | 'engineeringClass'
>): unknown {
  return {
    schemaVersion: contract.schemaVersion,
    missionId: contract.missionId,
    projectId: contract.projectId,
    workspaceId: contract.workspaceId,
    commanderRequest: contract.commanderRequest,
    goal: contract.goal,
    nonGoals: [...contract.nonGoals],
    constraints: [...contract.constraints],
    specId: contract.specId,
    specVersion: contract.specVersion,
    taskIds: [...contract.taskIds],
    acceptanceContractId: contract.acceptanceContractId,
    authoritySnapshot: contract.authoritySnapshot,
    engineeringClass: contract.engineeringClass,
  }
}

export function acceptanceContractIdentityMaterial(contract: Pick<
  FoundryAcceptanceContract,
  'schemaVersion' | 'missionContractId' | 'version' | 'criteria'
>): unknown {
  return {
    schemaVersion: contract.schemaVersion,
    missionContractId: contract.missionContractId,
    version: contract.version,
    criteria: [...contract.criteria].sort((a, b) => a.criterionId.localeCompare(b.criterionId)),
  }
}

export function hashMissionContractIdentity(contract: Parameters<typeof missionContractIdentityMaterial>[0]): string {
  return foundryContentHash(missionContractIdentityMaterial(contract))
}

export function hashAcceptanceContractIdentity(contract: Parameters<typeof acceptanceContractIdentityMaterial>[0]): string {
  return foundryContentHash(acceptanceContractIdentityMaterial(contract))
}

export function specIdentityMaterial(input: {
  specId: string
  specVersion: string
  goal: string
  nonGoals: string[]
  constraints: string[]
  taskIds: string[]
  commanderRequest: string
  acceptanceContractHash: string
}): unknown {
  return {
    specId: input.specId,
    specVersion: input.specVersion,
    goal: input.goal,
    nonGoals: [...input.nonGoals],
    constraints: [...input.constraints],
    taskIds: [...input.taskIds],
    commanderRequest: input.commanderRequest,
    acceptanceContractHash: input.acceptanceContractHash,
  }
}

export function hashSpecIdentity(input: Parameters<typeof specIdentityMaterial>[0]): string {
  return foundryContentHash(specIdentityMaterial(input))
}

export const NON_MATERIAL_GRAPH_FIELDS = [
  'updatedAt',
  'recoveryCount',
  'lastRecoveryAt',
  'paused',
  'cancelRequested',
  'lastHeartbeat',
  'pollingMetadata',
  'uiExpansionState',
  'displayLabel',
] as const
