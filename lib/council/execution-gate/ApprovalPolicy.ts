import type { ExecutionPlan } from '../execution-plan'
import type { ApprovalState, ExecutionGateDecision } from './types'

export class ApprovalPolicy {
  resolve(input: {
    executionPlan: ExecutionPlan
    gateDecision: ExecutionGateDecision
  }): {
    approvalState: ApprovalState
    approvalRequired: boolean
    approvalReason: string | null
  } {
    const { executionPlan, gateDecision } = input
    if (gateDecision.gateState === 'blocked' || gateDecision.gateState === 'unsupported') {
      return {
        approvalState: 'blocked',
        approvalRequired: true,
        approvalReason: gateDecision.reason,
      }
    }
    if (executionPlan.approvalRequired || gateDecision.requiredApprovals.length > 0) {
      return {
        approvalState: 'required',
        approvalRequired: true,
        approvalReason: 'Operator approval is required before any future execution phase may proceed.',
      }
    }
    return {
      approvalState: 'approved_preview_only',
      approvalRequired: false,
      approvalReason: null,
    }
  }
}
