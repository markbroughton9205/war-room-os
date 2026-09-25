/**
 * Immutable Commander execution-approval snapshots.
 * Approved hashes live here. Live contract hashes stay on the graph/mission.
 * Never rewrite an ACTIVE approval's bound content.
 */
import { randomUUID } from 'node:crypto'
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import {
  FOUNDRY_AUTHORITY_SNAPSHOT_ID,
  FOUNDRY_CONTRACT_SCHEMA_VERSION,
  classifyLegacyPreContract,
  type FoundryAcceptanceContract,
  type FoundryExecutionApproval,
  type FoundryMissionContract,
  type FoundryVerdictRecord,
} from './foundryContractTypes'
import { hashSpecIdentity } from './foundryContractHash'
import {
  appendContractEvent,
  archiveVerdictRecord,
  listExecutionApprovals,
  loadActiveExecutionApproval,
  loadExecutionApproval,
  loadMissionContract,
  loadAcceptanceContract,
  loadVerdictRecord,
  saveExecutionApproval,
  saveVerdictRecord,
  loadActiveResourceBudget,
} from './foundryContractStore'

export type ApprovalExpectedGeneration = {
  specVersion?: string | null
  missionContractId?: string | null
  missionContractHash?: string | null
  acceptanceContractId?: string | null
  acceptanceContractHash?: string | null
}

export type ApprovalBinding = {
  ok: boolean
  reapprovalRequired: boolean
  reason: string | null
  missing: string[]
  approval: FoundryExecutionApproval | null
  live: {
    specVersion: string | null
    missionContractId: string | null
    missionContractHash: string | null
    acceptanceContractId: string | null
    acceptanceContractHash: string | null
    specContentHash: string | null
  }
}

export function specContentHashForContracts(
  missionContract: FoundryMissionContract,
  acceptanceContract: FoundryAcceptanceContract,
): string {
  return hashSpecIdentity({
    specId: missionContract.specId,
    specVersion: missionContract.specVersion,
    goal: missionContract.goal,
    nonGoals: missionContract.nonGoals,
    constraints: missionContract.constraints,
    taskIds: missionContract.taskIds,
    commanderRequest: missionContract.commanderRequest,
    acceptanceContractHash: acceptanceContract.contentHash,
  })
}

export function sameSpecVersionDifferentContent(previous: FoundryMissionContract, next: FoundryMissionContract, previousAcceptanceHash: string, nextAcceptanceHash: string): boolean {
  return previous.specVersion === next.specVersion
    && specContentHashForContracts(previous, {
      ...({} as FoundryAcceptanceContract),
      contentHash: previousAcceptanceHash,
    } as FoundryAcceptanceContract) !== specContentHashForContracts(next, {
      ...({} as FoundryAcceptanceContract),
      contentHash: nextAcceptanceHash,
    } as FoundryAcceptanceContract)
}

function liveFromContracts(missionContract: FoundryMissionContract | null, acceptanceContract: FoundryAcceptanceContract | null): ApprovalBinding['live'] {
  return {
    specVersion: missionContract?.specVersion ?? null,
    missionContractId: missionContract?.missionContractId ?? null,
    missionContractHash: missionContract?.contentHash ?? null,
    acceptanceContractId: acceptanceContract?.acceptanceContractId ?? null,
    acceptanceContractHash: acceptanceContract?.contentHash ?? null,
    specContentHash: missionContract && acceptanceContract ? specContentHashForContracts(missionContract, acceptanceContract) : null,
  }
}

export function approvalMatchesGeneration(
  approval: FoundryExecutionApproval | null | undefined,
  missionContract: FoundryMissionContract | null,
  acceptanceContract: FoundryAcceptanceContract | null,
): boolean {
  if (!approval || approval.status !== 'ACTIVE') return false
  if (!missionContract || !acceptanceContract) return false
  if (missionContract.status !== 'SEALED' || acceptanceContract.status !== 'SEALED') return false
  return (
    approval.specVersion === missionContract.specVersion
    && approval.missionContractId === missionContract.missionContractId
    && approval.missionContractHash === missionContract.contentHash
    && approval.acceptanceContractId === acceptanceContract.acceptanceContractId
    && approval.acceptanceContractHash === acceptanceContract.contentHash
  )
}

export function evaluateApprovalBinding(input: {
  engineeringClass?: string | null
  missionId: string
  graphId?: string | null
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
}): ApprovalBinding {
  if (classifyLegacyPreContract(input.engineeringClass) !== 'STANDALONE_ENGINEER') {
    return {
      ok: true,
      reapprovalRequired: false,
      reason: null,
      missing: [],
      approval: null,
      live: liveFromContracts(input.missionContract ?? null, input.acceptanceContract ?? null),
    }
  }
  const missionContract = input.missionContract ?? null
  const acceptanceContract = input.acceptanceContract ?? null
  const live = liveFromContracts(missionContract, acceptanceContract)
  const approval = loadActiveExecutionApproval(input.missionId, input.graphId)
  const missing: string[] = []
  if (!approval) missing.push('EXECUTION_APPROVAL')
  else if (approval.status !== 'ACTIVE') missing.push(`APPROVAL_${approval.status}`)
  if (!missionContract || missionContract.status !== 'SEALED') missing.push('MISSION_CONTRACT_SEALED')
  if (!acceptanceContract || acceptanceContract.status !== 'SEALED') missing.push('ACCEPTANCE_CONTRACT_SEALED')
  if (approval && missionContract && approval.specVersion !== missionContract.specVersion) missing.push('SPEC_VERSION_MISMATCH')
  if (approval && missionContract && approval.missionContractId !== missionContract.missionContractId) missing.push('MISSION_CONTRACT_ID_MISMATCH')
  if (approval && missionContract && approval.missionContractHash !== missionContract.contentHash) missing.push('MISSION_CONTRACT_HASH_MISMATCH')
  if (approval && acceptanceContract && approval.acceptanceContractId !== acceptanceContract.acceptanceContractId) missing.push('ACCEPTANCE_CONTRACT_ID_MISMATCH')
  if (approval && acceptanceContract && approval.acceptanceContractHash !== acceptanceContract.contentHash) missing.push('ACCEPTANCE_CONTRACT_HASH_MISMATCH')
  const sealed = missionContract?.status === 'SEALED' && acceptanceContract?.status === 'SEALED'
  const reapprovalRequired = missing.some(item =>
    item.startsWith('APPROVAL_')
    || item.endsWith('_MISMATCH')
    || (item === 'EXECUTION_APPROVAL' && sealed),
  )
  const reason = reapprovalRequired
    ? `REAPPROVAL_REQUIRED: ${missing.join(', ')}`
    : (missing.length ? `STANDALONE_ENGINEER execution refused: ${missing.join(', ')}` : null)
  return {
    ok: missing.length === 0 && approvalMatchesGeneration(approval, missionContract, acceptanceContract),
    reapprovalRequired,
    reason,
    missing,
    approval,
    live,
  }
}

export function recoverApprovalBinding(input: {
  engineeringClass?: string | null
  missionId: string
  graphId?: string | null
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
}): ApprovalBinding {
  const binding = evaluateApprovalBinding(input)
  if (binding.reapprovalRequired && classifyLegacyPreContract(input.engineeringClass) === 'STANDALONE_ENGINEER') {
    appendContractEvent(input.missionId, 'REAPPROVAL_REQUIRED', binding.reason ?? 'Restart recovery found approval/hash mismatch. Approval hashes were not rewritten.')
  }
  return binding
}

export function createExecutionApproval(input: {
  missionId: string
  graphId?: string | null
  projectId?: string | null
  missionContract: FoundryMissionContract
  acceptanceContract: FoundryAcceptanceContract
  expected?: ApprovalExpectedGeneration | null
  mission?: FoundryMissionRecord | null
}): FoundryExecutionApproval {
  if (input.missionContract.status !== 'SEALED' || input.acceptanceContract.status !== 'SEALED') {
    throw new Error('Cannot approve execution without sealed contracts.')
  }
  if (input.expected) {
    const stale =
      (input.expected.specVersion != null && input.expected.specVersion !== input.missionContract.specVersion)
      || (input.expected.missionContractId != null && input.expected.missionContractId !== input.missionContract.missionContractId)
      || (input.expected.missionContractHash != null && input.expected.missionContractHash !== input.missionContract.contentHash)
      || (input.expected.acceptanceContractId != null && input.expected.acceptanceContractId !== input.acceptanceContract.acceptanceContractId)
      || (input.expected.acceptanceContractHash != null && input.expected.acceptanceContractHash !== input.acceptanceContract.contentHash)
    if (stale) {
      throw new Error('APPROVAL_TARGET_STALE: Commander approved a generation that is no longer current. Reload and re-approve the live contracts.')
    }
  }
  const previous = loadActiveExecutionApproval(input.missionId, input.graphId)
  if (previous) supersedeExecutionApproval(previous.approvalId, input.mission, 'Superseded by a new Commander execution approval.')
  const approval: FoundryExecutionApproval = {
    schemaVersion: FOUNDRY_CONTRACT_SCHEMA_VERSION,
    approvalId: `EA-${randomUUID()}`,
    missionId: input.missionId,
    graphId: input.graphId ?? null,
    projectId: input.projectId ?? input.missionContract.projectId,
    specId: input.missionContract.specId,
    specVersion: input.missionContract.specVersion,
    specContentHash: specContentHashForContracts(input.missionContract, input.acceptanceContract),
    missionContractId: input.missionContract.missionContractId,
    missionContractHash: input.missionContract.contentHash,
    acceptanceContractId: input.acceptanceContract.acceptanceContractId,
    acceptanceContractHash: input.acceptanceContract.contentHash,
    approvedBy: 'COMMANDER',
    approvedAt: new Date().toISOString(),
    authoritySnapshotId: FOUNDRY_AUTHORITY_SNAPSHOT_ID,
    status: 'ACTIVE',
    supersedesApprovalId: previous?.approvalId ?? null,
    resourceBudgetId: loadActiveResourceBudget(input.missionId)?.budgetId ?? null,
  }
  saveExecutionApproval(approval)
  appendContractEvent(
    input.missionId,
    previous ? 'REAPPROVAL_COMPLETED' : 'EXECUTION_APPROVAL_CREATED',
    `Execution approval ${approval.approvalId} bound spec v${approval.specVersion} mission=${approval.missionContractHash.slice(0, 12)} acceptance=${approval.acceptanceContractHash.slice(0, 12)}`,
    input.mission,
    { approvalId: approval.approvalId, specVersion: approval.specVersion },
  )
  return approval
}

export function supersedeExecutionApproval(approvalId: string, mission?: FoundryMissionRecord | null, reason = 'Contract generation changed. Prior approval is historical.'): FoundryExecutionApproval {
  const approval = loadExecutionApproval(approvalId)
  if (!approval) throw new Error(`Unknown execution approval ${approvalId}`)
  if (approval.status !== 'ACTIVE') return approval
  const next: FoundryExecutionApproval = { ...approval, status: 'SUPERSEDED' }
  saveExecutionApproval(next)
  appendContractEvent(approval.missionId, 'EXECUTION_APPROVAL_SUPERSEDED', `${reason} approvalId=${approval.approvalId}`, mission, {
    approvalId: approval.approvalId,
  })
  appendContractEvent(approval.missionId, 'REAPPROVAL_REQUIRED', `REAPPROVAL_REQUIRED: prior approval ${approval.approvalId} no longer matches live contracts.`, mission, {
    approvalId: approval.approvalId,
  })
  return next
}

export function revokeExecutionApproval(approvalId: string, mission?: FoundryMissionRecord | null): FoundryExecutionApproval {
  const approval = loadExecutionApproval(approvalId)
  if (!approval) throw new Error(`Unknown execution approval ${approvalId}`)
  if (approval.status === 'REVOKED') return approval
  const next: FoundryExecutionApproval = { ...approval, status: 'REVOKED' }
  saveExecutionApproval(next)
  appendContractEvent(approval.missionId, 'EXECUTION_APPROVAL_REVOKED', `Commander revoked execution approval ${approval.approvalId}`, mission, {
    approvalId: approval.approvalId,
  })
  return next
}

export function supersedeActiveApprovals(missionId: string, graphId?: string | null, mission?: FoundryMissionRecord | null): FoundryExecutionApproval[] {
  return listExecutionApprovals(missionId, graphId)
    .filter(item => item.status === 'ACTIVE')
    .map(item => supersedeExecutionApproval(item.approvalId, mission))
}

export function invalidateVerdictForNewGeneration(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  mission?: FoundryMissionRecord | null
  reason?: string
}): FoundryVerdictRecord | null {
  const previous = loadVerdictRecord(input.missionId)
  if (previous) {
    archiveVerdictRecord(previous)
    appendContractEvent(input.missionId, 'VERDICT_INVALIDATED', input.reason ?? `Prior Verdict ${previous.result} archived; current generation is not evaluated.`, input.mission, {
      verdictId: previous.verdictId,
      previousResult: previous.result,
    })
    if (previous.result === 'PASS') {
      appendContractEvent(input.missionId, 'PROJECT_READY_INVALIDATED', 'PROJECT READY for the prior generation is historical. Current generation is NOT READY.', input.mission, {
        verdictId: previous.verdictId,
      })
      if (input.graph?.result) {
        input.graph.result.projectReady = false
        input.graph.result.verification = `Historical PROJECT READY archived with verdict ${previous.verdictId}. Current generation is NOT READY.`
      }
    }
  }
  const current: FoundryVerdictRecord = {
    schemaVersion: 1,
    verdictId: `VD-${randomUUID()}`,
    missionId: input.missionId,
    graphId: input.graph?.graphId ?? previous?.graphId ?? null,
    missionContractId: input.graph?.missionContractId ?? previous?.missionContractId ?? '',
    acceptanceContractId: input.graph?.acceptanceContractId ?? previous?.acceptanceContractId ?? '',
    missionContractHash: input.graph?.missionContractHash ?? '',
    acceptanceContractHash: input.graph?.acceptanceContractHash ?? '',
    specVersion: input.graph?.specVersion ?? '',
    result: 'INCONCLUSIVE',
    reasons: [input.reason ?? 'Prior Verdict cannot authorize a new contract generation.'],
    missingCriterionIds: [],
    failedCriterionIds: [],
    inconclusiveCriterionIds: [],
    staleEvidenceIds: [],
    reviewOutcome: null,
    executorResult: 'NONE',
    evaluatedAt: new Date().toISOString(),
    midEvaluation: false,
  }
  saveVerdictRecord(current)
  return current
}

export function bindLiveContractsToGraph(
  graph: FoundryCommandCenterGraph,
  missionContract: FoundryMissionContract,
  acceptanceContract: FoundryAcceptanceContract,
): FoundryCommandCenterGraph {
  graph.missionContractId = missionContract.missionContractId
  graph.acceptanceContractId = acceptanceContract.acceptanceContractId
  graph.missionContractHash = missionContract.contentHash
  graph.acceptanceContractHash = acceptanceContract.contentHash
  graph.specId = missionContract.specId
  graph.specVersion = missionContract.specVersion
  return graph
}

export function haltGraphForReapproval(graph: FoundryCommandCenterGraph, reason = 'REAPPROVAL_REQUIRED'): FoundryCommandCenterGraph {
  graph.planningMode = true
  graph.specApproved = false
  const liveWork = graph.tasks.some(task => !['COMPLETE', 'FAILED', 'CANCELLED'].includes(task.status))
  if (liveWork || !['COMPLETE', 'FAILED', 'CANCELLED'].includes(graph.status)) {
    graph.status = 'PLANNING'
  }
  for (const task of graph.tasks) {
    if (task.status === 'COMPLETE' || task.status === 'CANCELLED' || task.status === 'FAILED') continue
    if (task.status === 'RUNNING') {
      task.latestAction = `${reason}: in-flight governed call may finish; further mutation is halted.`
      continue
    }
    task.status = 'PLANNING'
    task.blocker = 'REAPPROVAL_REQUIRED'
    task.latestAction = `${reason}: Commander must approve the current contract generation.`
  }
  return graph
}

export function applyContractSupersessionToGraph(
  graph: FoundryCommandCenterGraph,
  nextMission: FoundryMissionContract,
  nextAcceptance: FoundryAcceptanceContract,
): FoundryCommandCenterGraph {
  bindLiveContractsToGraph(graph, nextMission, nextAcceptance)
  if (graph.result) {
    graph.result.projectReady = false
    graph.result.verification = 'Historical PROJECT READY remains archived. Current generation is NOT READY until reapproval, evidence, and Verdict PASS.'
  }
  haltGraphForReapproval(graph)
  graph.approvalId = null
  return graph
}

export { loadActiveExecutionApproval, listExecutionApprovals, loadExecutionApproval }
