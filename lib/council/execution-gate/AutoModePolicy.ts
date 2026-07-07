import type { ExecutionPlan } from '../execution-plan'
import type { AutoActionType, AutoModePolicy as AutoModePolicyShape } from './types'

const BLOCKED_AUTO_ACTION_TYPES: AutoActionType[] = [
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
]

export class AutoModePolicy {
  resolve(executionPlan: ExecutionPlan): AutoModePolicyShape {
    const autoEligible = !executionPlan.approvalRequired && executionPlan.blockedReason === null
    const decisionPath = [
      'Auto Mode support is defined architecturally.',
      'autoModeEnabled is false in Phase 46F.',
      autoEligible
        ? 'Plan is preview-eligible, but Auto Mode remains disabled.'
        : 'Plan is not auto-eligible because approval or blocking conditions exist.',
      'allowedAutoActionTypes is empty.',
    ]

    return {
      autoModeSupported: true,
      autoModeEnabled: false,
      autoEligible,
      autoEligibilityReason: autoEligible
        ? 'This dry-run plan has no approval requirement or blocked reason, but cannot auto-execute in Phase 46F.'
        : null,
      autoBlockedReason: 'Auto Mode is not active in Phase 46F.',
      requiredApprovalBeforeAuto: true,
      allowedAutoActionTypes: [],
      blockedAutoActionTypes: [...BLOCKED_AUTO_ACTION_TYPES],
      decisionPath,
    }
  }
}
