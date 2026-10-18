/**
 * Draft, seal, and supersede MissionContract + AcceptanceContract.
 * Sealed contracts are immutable. Meaning changes require a new version + hash + approval.
 */
import { randomUUID } from 'node:crypto'
import {
  FOUNDRY_AUTHORITY_SNAPSHOT,
  FOUNDRY_CONTRACT_SCHEMA_VERSION,
  type FoundryAcceptanceContract,
  type FoundryAcceptanceCriterion,
  type FoundryEngineeringClass,
  type FoundryMissionContract,
} from './foundryContractTypes'
import {
  hashAcceptanceContractIdentity as hashAcceptanceContract,
  hashMissionContractIdentity as hashMissionContract,
} from './foundryContractHash'
import {
  appendContractEvent,
  loadMissionContract,
  saveAcceptanceContract,
  saveMissionContract,
} from './foundryContractStore'
import { supersedeEvidenceForContract } from './foundryAcceptanceEvidence'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import { invalidateVerdictForNewGeneration, supersedeActiveApprovals } from './foundryExecutionApproval'

export type MissionContractDraftInput = {
  missionId: string
  projectId?: string | null
  workspaceId?: string | null
  commanderRequest: string
  goal: string
  nonGoals?: string[]
  constraints?: string[]
  specId: string
  specVersion: string
  taskIds?: string[]
  engineeringClass?: FoundryEngineeringClass
  now?: string
}

export {
  acceptanceContractIdentityMaterial as acceptanceContractMaterial,
  hashAcceptanceContractIdentity as hashAcceptanceContract,
  hashMissionContractIdentity as hashMissionContract,
  missionContractIdentityMaterial as missionContractMaterial,
} from './foundryContractHash'

export function defaultTicketManagerCriteria(taskIds: string[]): FoundryAcceptanceCriterion[] {
  const related = taskIds.length ? taskIds : ['TASK-001']
  return [
    {
      criterionId: 'CR-TEST',
      description: 'Project tests pass with pass>0.',
      required: true,
      verificationType: 'TEST',
      expectedOutcome: 'node --test reports fail=0 and pass>0',
      evidenceRequirements: ['test.stdout', 'test.exit_code'],
      relatedTaskIds: related.slice(0, 3),
    },
    {
      criterionId: 'CR-RUNTIME',
      description: 'Local preview runtime responds on loopback.',
      required: true,
      verificationType: 'RUNTIME',
      expectedOutcome: 'HTTP health probe succeeds',
      evidenceRequirements: ['preview.origin', 'http.health'],
      relatedTaskIds: related.slice(-1),
    },
    {
      criterionId: 'CR-BROWSER',
      description: 'War Room / Foundry browser observed the local preview.',
      required: true,
      verificationType: 'BROWSER',
      expectedOutcome: 'localPreview URL recorded',
      evidenceRequirements: ['preview.localPreview'],
      relatedTaskIds: related.slice(-1),
    },
    {
      criterionId: 'CR-PERSISTENCE',
      description: 'Persistence behavior is covered by tests or restart proof.',
      required: true,
      verificationType: 'PERSISTENCE',
      expectedOutcome: 'tests or restart proof mention persist',
      evidenceRequirements: ['test.detail'],
      relatedTaskIds: related.slice(0, 2),
    },
    {
      criterionId: 'CR-SECURITY',
      description: 'Commit/push/deploy remain denied.',
      required: true,
      verificationType: 'SECURITY',
      expectedOutcome: 'AUTO_COMMIT=0 AUTO_PUSH=0 AUTO_DEPLOY=0',
      evidenceRequirements: ['governance.snapshot'],
      relatedTaskIds: [],
    },
    {
      criterionId: 'CR-SCOPE',
      description: 'Writes stay inside the isolated project; Harbor/Lane/Inventory/Terra/WRIM untouched.',
      required: true,
      verificationType: 'DIFF_SCOPE',
      expectedOutcome: 'no protected-product paths in filesChanged',
      evidenceRequirements: ['filesChanged'],
      relatedTaskIds: related,
    },
  ]
}

export function criteriaFromAcceptanceStrings(lines: string[], taskIds: string[] = []): FoundryAcceptanceCriterion[] {
  const trimmed = lines.map(line => line.trim()).filter(Boolean)
  if (!trimmed.length) return defaultTicketManagerCriteria(taskIds)
  return trimmed.map((description, index) => ({
    criterionId: `CR-${String(index + 1).padStart(3, '0')}`,
    description,
    required: true,
    verificationType: /test/i.test(description) ? 'TEST'
      : /browser|viewport|preview/i.test(description) ? 'BROWSER'
        : /persist|sqlite|restart/i.test(description) ? 'PERSISTENCE'
          : /build/i.test(description) ? 'BUILD'
            : /security|commit|push|deploy/i.test(description) ? 'SECURITY'
              : /runtime|health|http/i.test(description) ? 'RUNTIME'
                : 'CUSTOM_EVIDENCE',
    expectedOutcome: description,
    evidenceRequirements: ['bound.artifact'],
    relatedTaskIds: taskIds,
  }))
}

export function draftStandaloneContracts(input: MissionContractDraftInput, criteria?: FoundryAcceptanceCriterion[]): {
  missionContract: FoundryMissionContract
  acceptanceContract: FoundryAcceptanceContract
} {
  const now = input.now ?? new Date().toISOString()
  const missionContractId = `MC-${randomUUID()}`
  const acceptanceContractId = `AC-${randomUUID()}`
  const taskIds = input.taskIds ?? []
  const acceptance: FoundryAcceptanceContract = {
    schemaVersion: FOUNDRY_CONTRACT_SCHEMA_VERSION,
    acceptanceContractId,
    missionContractId,
    version: input.specVersion,
    criteria: criteria?.length ? criteria : defaultTicketManagerCriteria(taskIds),
    createdAt: now,
    sealedAt: null,
    contentHash: '',
    status: 'DRAFT',
  }
  acceptance.contentHash = hashAcceptanceContract(acceptance)
  const missionContract: FoundryMissionContract = {
    schemaVersion: FOUNDRY_CONTRACT_SCHEMA_VERSION,
    missionContractId,
    missionId: input.missionId,
    projectId: input.projectId ?? null,
    workspaceId: input.workspaceId ?? null,
    commanderRequest: input.commanderRequest,
    goal: input.goal,
    nonGoals: input.nonGoals ?? ['Do not modify Harbor, Lane & Box, Inventory, Terra, or WRIM.', 'Do not commit, push, or live-deploy.'],
    constraints: input.constraints ?? ['FOUNDRY_IS_MISSION_OWNER', 'NO_AUTO_COMMIT', 'NO_AUTO_PUSH', 'NO_AUTO_DEPLOY'],
    specId: input.specId,
    specVersion: input.specVersion,
    taskIds,
    acceptanceContractId,
    authoritySnapshot: FOUNDRY_AUTHORITY_SNAPSHOT,
    engineeringClass: input.engineeringClass ?? 'STANDALONE_ENGINEER',
    createdAt: now,
    sealedAt: null,
    contentHash: '',
    status: 'DRAFT',
  }
  missionContract.contentHash = hashMissionContract(missionContract)
  saveAcceptanceContract(acceptance)
  saveMissionContract(missionContract)
  appendContractEvent(input.missionId, 'MISSION_CONTRACT_DRAFTED', `Drafted ${missionContractId} hash=${missionContract.contentHash.slice(0, 12)}`)
  return { missionContract, acceptanceContract: acceptance }
}

export function sealAcceptanceContract(contract: FoundryAcceptanceContract, mission?: FoundryMissionRecord | null): FoundryAcceptanceContract {
  if (contract.status === 'SUPERSEDED') throw new Error('Cannot seal a superseded acceptance contract.')
  const hash = hashAcceptanceContract(contract)
  const sealed: FoundryAcceptanceContract = {
    ...contract,
    contentHash: hash,
    status: 'SEALED',
    sealedAt: contract.sealedAt ?? new Date().toISOString(),
  }
  saveAcceptanceContract(sealed)
  const missionId = mission?.missionId ?? loadMissionContract(contract.missionContractId)?.missionId ?? contract.missionContractId
  appendContractEvent(missionId, 'ACCEPTANCE_CONTRACT_SEALED', `Sealed ${sealed.acceptanceContractId} hash=${hash.slice(0, 12)}`, mission, {
    acceptanceContractId: sealed.acceptanceContractId,
    contentHash: hash,
  })
  return sealed
}

export function sealMissionContract(contract: FoundryMissionContract, mission?: FoundryMissionRecord | null): FoundryMissionContract {
  if (contract.status === 'SUPERSEDED') throw new Error('Cannot seal a superseded mission contract.')
  const hash = hashMissionContract(contract)
  const sealed: FoundryMissionContract = {
    ...contract,
    contentHash: hash,
    status: 'SEALED',
    sealedAt: contract.sealedAt ?? new Date().toISOString(),
  }
  saveMissionContract(sealed)
  appendContractEvent(contract.missionId, 'MISSION_CONTRACT_SEALED', `Sealed ${sealed.missionContractId} hash=${hash.slice(0, 12)}`, mission, {
    missionContractId: sealed.missionContractId,
    contentHash: hash,
    specVersion: sealed.specVersion,
  })
  return sealed
}

export function assertSealedImmutable(contract: FoundryMissionContract | FoundryAcceptanceContract): void {
  if (contract.status !== 'SEALED') return
  const current = 'goal' in contract ? hashMissionContract(contract) : hashAcceptanceContract(contract)
  if (current !== contract.contentHash) {
    throw new Error('SEALED_CONTRACT_MUTATION_REFUSED: content no longer matches sealed hash. Supersede with a new version.')
  }
}

export function supersedeMissionContract(
  previous: FoundryMissionContract,
  patch: Partial<Pick<FoundryMissionContract, 'goal' | 'nonGoals' | 'constraints' | 'specVersion' | 'taskIds' | 'commanderRequest'>>,
  approved: boolean,
  mission?: FoundryMissionRecord | null,
  criteria?: FoundryAcceptanceCriterion[],
): { previous: FoundryMissionContract; next: FoundryMissionContract } {
  if (!approved) throw new Error('Commander approval is required to supersede a sealed MissionContract.')
  const frozen: FoundryMissionContract = { ...previous, status: 'SUPERSEDED' }
  saveMissionContract(frozen)
  const requestedVersion = patch.specVersion ?? bumpSpecVersion(previous.specVersion)
  const nextVersion = requestedVersion === previous.specVersion ? bumpSpecVersion(previous.specVersion) : requestedVersion
  const nextDraft = draftStandaloneContracts({
    missionId: previous.missionId,
    projectId: previous.projectId,
    workspaceId: previous.workspaceId,
    commanderRequest: patch.commanderRequest ?? previous.commanderRequest,
    goal: patch.goal ?? previous.goal,
    nonGoals: patch.nonGoals ?? previous.nonGoals,
    constraints: patch.constraints ?? previous.constraints,
    specId: previous.specId,
    specVersion: nextVersion,
    taskIds: patch.taskIds ?? previous.taskIds,
    engineeringClass: previous.engineeringClass,
  }, criteria)
  nextDraft.missionContract.supersedesContractId = previous.missionContractId
  nextDraft.acceptanceContract.supersedesContractId = previous.acceptanceContractId
  supersedeEvidenceForContract(previous.missionId, previous.missionContractId, previous.acceptanceContractId)
  const sealedAcceptance = sealAcceptanceContract(nextDraft.acceptanceContract, mission)
  nextDraft.missionContract.acceptanceContractId = sealedAcceptance.acceptanceContractId
  const sealedMission = sealMissionContract(nextDraft.missionContract, mission)
  supersedeActiveApprovals(previous.missionId, null, mission)
  invalidateVerdictForNewGeneration({
    missionId: previous.missionId,
    mission,
    reason: 'Contract supersession invalidated the prior Verdict for the new generation.',
  })
  if (mission) {
    mission.missionContractId = sealedMission.missionContractId
    mission.acceptanceContractId = sealedAcceptance.acceptanceContractId
    mission.missionContractHash = sealedMission.contentHash
    mission.acceptanceContractHash = sealedAcceptance.contentHash
    mission.contractSpecApproved = false
    mission.planningMode = true
    mission.executionApprovalId = null
  }
  return { previous: frozen, next: sealedMission }
}

function bumpSpecVersion(version: string): string {
  const n = Number.parseInt(version, 10)
  if (Number.isFinite(n)) return String(n + 1)
  return `${version}.2`
}

export function supersedeAcceptanceContract(
  previousMission: FoundryMissionContract,
  criteria: FoundryAcceptanceCriterion[],
  approved: boolean,
  mission?: FoundryMissionRecord | null,
): { previous: FoundryMissionContract; next: FoundryMissionContract } {
  if (!approved) throw new Error('Commander approval is required to supersede a sealed AcceptanceContract.')
  return supersedeMissionContract(previousMission, { specVersion: bumpSpecVersion(previousMission.specVersion) }, approved, mission, criteria)
}
