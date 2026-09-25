/**
 * Foundry Planning Mode helpers.
 * Read-only catalog, mutation suppression, and plan-reminder ideas adapted from
 * kkkhs/ClawdCode plan permission mode and prompts/plan.ts
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md.
 *
 * Foundry specification/planning remains authoritative. This does not create a
 * second permission authority.
 */
import { classifyToolIdempotency } from './foundryToolLifecycle'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryModelToolDescription } from './foundryModelTypes'
import { canEnterExecutionFromMission } from './foundryVerdictLayer'
import { loadAcceptanceContract, loadMissionContract } from './foundryContractStore'
import { createExecutionApproval, type ApprovalExpectedGeneration } from './foundryExecutionApproval'

export const FOUNDRY_PLANNING_MODE_REMINDER =
  'Planning Mode is active. Use read-only Tool Broker tools only. Do not mutate files, run shell, or install. Present a plan, then wait for Commander approval to enter execution.'

export function isFoundryPlanningMode(mission: Pick<FoundryMissionRecord, 'planningMode' | 'constraints' | 'status'>): boolean {
  if (mission.planningMode === true) return true
  const constraints = mission.constraints ?? []
  return constraints.includes('PLANNING_MODE') || constraints.includes('READ_ONLY_INVESTIGATION')
}

export function foundryPlanningReadOnlyCatalog(): FoundryModelToolDescription[] {
  return FOUNDRY_MODEL_TOOL_CATALOG.filter(entry => !entry.mutating && classifyToolIdempotency(entry.name) === 'READ_ONLY')
}

export function planningModeBlocksTool(mission: Pick<FoundryMissionRecord, 'planningMode' | 'constraints' | 'status'>, tool: string): string | null {
  if (!isFoundryPlanningMode(mission)) return null
  if (tool === 'process.stop' || tool === 'browser.stop' || tool === 'mission.cancel' || tool === 'mission.status' || tool === 'mission.journal') {
    return null
  }
  if (classifyToolIdempotency(tool) !== 'READ_ONLY') {
    return `PLANNING_MODE: mutation suppressed for ${tool}. Present the plan and wait for Commander approval to enter execution.`
  }
  return null
}

export function requestPlanningToExecution(mission: FoundryMissionRecord): { waiting: true; action: string } {
  mission.planningMode = true
  if (!mission.constraints.includes('PLANNING_MODE')) mission.constraints.push('PLANNING_MODE')
  mission.authorization = {
    waiting: true,
    action: 'ENTER_EXECUTION',
    reason: 'Planning Mode completed a read-only plan. Commander approval is required before mutation.',
    target: mission.missionId,
    impact: 'Allows Tool Broker mutation tools for this mission only. Does not grant commit, push, live deploy, or a second permission authority.',
    requestedAt: new Date().toISOString(),
    approvalState: 'pending',
  }
  return { waiting: true, action: 'ENTER_EXECUTION' }
}

export function enterFoundryExecutionFromPlan(
  mission: FoundryMissionRecord,
  approved: boolean,
  expected?: ApprovalExpectedGeneration | null,
): { ok: boolean; error?: string } {
  if (!approved) {
    mission.authorization = {
      ...(mission.authorization ?? { waiting: false, action: 'ENTER_EXECUTION', reason: null }),
      waiting: false,
      approvalState: 'denied',
      reason: 'Commander denied Planning Mode → execution.',
    }
    return { ok: false, error: 'Commander denied Planning Mode → execution.' }
  }
  if (mission.engineeringClass === 'STANDALONE_ENGINEER') {
    const gate = canEnterExecutionFromMission({ ...mission, contractSpecApproved: true })
    if (gate.missing.filter(item => item !== 'SPEC_APPROVED' && item !== 'EXECUTION_APPROVAL' && item !== 'REAPPROVAL_REQUIRED' && !item.endsWith('_MISMATCH') && !item.startsWith('APPROVAL_')).length) {
      return { ok: false, error: gate.error ?? 'Sealed MissionContract required before execution.' }
    }
    const missionContract = mission.missionContractId ? loadMissionContract(mission.missionContractId) : null
    const acceptanceContract = mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null
    if (!missionContract || !acceptanceContract) {
      return { ok: false, error: 'Sealed MissionContract required before execution.' }
    }
    try {
      const approval = createExecutionApproval({
        missionId: mission.missionId,
        projectId: mission.applicationBuilder?.project?.projectId ?? null,
        missionContract,
        acceptanceContract,
        expected,
        mission,
      })
      mission.executionApprovalId = approval.approvalId
      mission.executionApprovalIds = [...(mission.executionApprovalIds ?? []).filter(id => id !== approval.approvalId), approval.approvalId]
      mission.contractSpecApproved = true
      mission.missionContractHash = missionContract.contentHash
      mission.acceptanceContractHash = acceptanceContract.contentHash
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  mission.planningMode = false
  mission.constraints = mission.constraints.filter(item => item !== 'PLANNING_MODE' && item !== 'READ_ONLY_INVESTIGATION')
  if (mission.authorization) {
    mission.authorization = {
      ...mission.authorization,
      waiting: false,
      approvalState: 'approved',
      reason: 'Commander approved Planning Mode → execution.',
    }
  }
  return { ok: true }
}
