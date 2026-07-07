import type { ExecutionPlan } from '../execution-plan'
import type { BlockedAction, BlockedExecutionType, RequiredApproval } from './types'

export const ALL_BLOCKED_EXECUTION_TYPES: BlockedExecutionType[] = [
  'provider_call',
  'tool_call',
  'database_mutation',
  'repo_mutation',
  'message_send',
  'payment_action',
  'deployment_action',
  'live_research',
  'memory_write',
  'external_side_effect',
  'auto_mode_action',
]

function requiredApprovalFor(blockedType: BlockedExecutionType): RequiredApproval {
  if (blockedType === 'payment_action') return 'security_review'
  if (blockedType === 'database_mutation' || blockedType === 'memory_write') return 'privacy_review'
  if (blockedType === 'deployment_action' || blockedType === 'repo_mutation') return 'security_review'
  if (blockedType === 'provider_call' || blockedType === 'live_research') return 'cost_approval'
  if (blockedType === 'auto_mode_action') return 'execution_not_supported'
  return 'commander_approval'
}

function blockedReasonFor(blockedType: BlockedExecutionType, executionPlan: ExecutionPlan): string {
  if (blockedType === 'live_research' && executionPlan.blockedReason?.includes('Live research')) {
    return 'Live research is required by the dry-run plan but cannot execute in Phase 46F.'
  }
  if (blockedType === 'message_send') return 'Message sending is blocked; preview may prepare text only.'
  if (blockedType === 'database_mutation') return 'Database mutation is blocked; no Supabase writes are allowed.'
  if (blockedType === 'repo_mutation') return 'Repository mutation is blocked; no commit, push, or file mutation is allowed.'
  if (blockedType === 'deployment_action') return 'Deployment is blocked; no Vercel/Netlify or production action is allowed.'
  if (blockedType === 'auto_mode_action') return 'Auto Mode is architecturally supported but disabled in Phase 46F.'
  return `Execution type ${blockedType} is blocked in Phase 46F preview-only mode.`
}

export class BlockedActionPlanner {
  plan(executionPlan: ExecutionPlan): BlockedAction[] {
    return ALL_BLOCKED_EXECUTION_TYPES.map(blockedType => ({
      actionId: `blocked_${blockedType}`,
      label: `Block ${blockedType}`,
      blockedExecutionType: blockedType,
      blockedReason: blockedReasonFor(blockedType, executionPlan),
      requiredApprovalType: requiredApprovalFor(blockedType),
    }))
  }
}
