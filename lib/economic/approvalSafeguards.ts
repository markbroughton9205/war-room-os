import { ECONOMIC_APPROVAL_ACTIONS } from '@/lib/economic/types'
import type { EconomicApprovalAction } from '@/lib/economic/types'

export type ApprovalGate = {
  action: EconomicApprovalAction
  requiresHumanApproval: true
  autonomousExecutionAllowed: false
}

export const ECONOMIC_APPROVAL_GATES: readonly ApprovalGate[] = ECONOMIC_APPROVAL_ACTIONS.map(action => ({
  action,
  requiresHumanApproval: true,
  autonomousExecutionAllowed: false,
}))

export const ECONOMIC_APPROVAL_GATE_BY_ACTION: ReadonlyMap<EconomicApprovalAction, ApprovalGate> =
  new Map(ECONOMIC_APPROVAL_GATES.map(gate => [gate.action, gate]))

export function approvalGateFor(action: EconomicApprovalAction): ApprovalGate {
  const gate = ECONOMIC_APPROVAL_GATE_BY_ACTION.get(action)
  if (!gate) {
    throw new Error(`Unknown economic approval action: ${action}`)
  }
  return gate
}

export function assertExternalActionRequiresApproval(action: EconomicApprovalAction): void {
  const gate = approvalGateFor(action)
  if (!gate.requiresHumanApproval || gate.autonomousExecutionAllowed) {
    throw new Error(`External action is not safely approval-gated: ${action}`)
  }
}

export function assertAllExternalActionsApprovalGated(): void {
  for (const action of ECONOMIC_APPROVAL_ACTIONS) {
    assertExternalActionRequiresApproval(action)
  }
}
