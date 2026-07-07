import type { ExecutionPlan } from '../execution-plan'
import { ALL_BLOCKED_EXECUTION_TYPES } from './BlockedActionPlanner'
import type { ExecutionGateDecision, GateState, RequiredApproval } from './types'

function createGateDecisionId(executionPlanId: string): string {
  return `gate_${executionPlanId.replace(/[^a-zA-Z0-9]/g, '_')}`
}

function resolveGateState(executionPlan: ExecutionPlan): GateState {
  if (executionPlan.blockedReason) return 'blocked'
  if (executionPlan.approvalRequired) return 'approval_required'
  return 'preview_only'
}

function resolveRequiredApprovals(executionPlan: ExecutionPlan): RequiredApproval[] {
  const approvals = new Set<RequiredApproval>()
  const commanderMessage = executionPlan.commanderMessage.toLowerCase()
  if (executionPlan.approvalRequired) approvals.add('commander_approval')
  if (executionPlan.safetyChecks.some(check => check.checkId.includes('privacy'))) {
    approvals.add('privacy_review')
  }
  if (executionPlan.blockedReason) approvals.add('execution_not_supported')
  if (/\b(send|email)\b/.test(commanderMessage)) approvals.add('commander_approval')
  if (/\b(supabase|database|db|update)\b/.test(commanderMessage)) approvals.add('privacy_review')
  if (/\b(deploy|vercel|netlify|production)\b/.test(commanderMessage)) approvals.add('security_review')
  if (/\b(commit|push|repo|repository)\b/.test(commanderMessage)) approvals.add('security_review')
  return Array.from(approvals)
}

export class ExecutionGate {
  decide(executionPlan: ExecutionPlan): ExecutionGateDecision {
    const gateState = resolveGateState(executionPlan)
    const requiredApprovals = resolveRequiredApprovals(executionPlan)
    const decisionPath = [
      `ExecutionGate evaluated ExecutionPlan ${executionPlan.executionPlanId}.`,
      `Gate state resolved as ${gateState}.`,
      'All real execution categories remain blocked in Phase 46F.',
      'executionAllowed is false.',
      'liveExecutionEnabled is false.',
    ]

    return {
      gateDecisionId: createGateDecisionId(executionPlan.executionPlanId),
      executionPlanId: executionPlan.executionPlanId,
      gateState,
      executionAllowed: false,
      liveExecutionEnabled: false,
      blockedExecutionTypes: [...ALL_BLOCKED_EXECUTION_TYPES],
      requiredApprovals,
      reason: executionPlan.blockedReason ?? 'Preview is allowed, but live execution is disabled in Phase 46F.',
      decisionPath,
    }
  }
}
