import type { ExecutionPlan } from '../execution-plan'
import type { ApprovedNextAction, ExecutionGateDecision } from './types'

export class AllowedNextActionPlanner {
  plan(input: {
    executionPlan: ExecutionPlan
    gateDecision: ExecutionGateDecision
  }): ApprovedNextAction[] {
    const { executionPlan, gateDecision } = input
    const actions: ApprovedNextAction[] = [
      {
        actionId: 'show_preview',
        label: 'Show preview',
        actionType: 'show_preview',
        description: 'Display the non-executing plan preview.',
        requiresHumanApproval: false,
      },
      {
        actionId: 'copy_work_packet',
        label: 'Copy work packet',
        actionType: 'copy_work_packet',
        description: 'Prepare a copyable dry-run work packet for operator review.',
        requiresHumanApproval: false,
      },
      {
        actionId: 'copy_validation_prompt',
        label: 'Copy validation prompt',
        actionType: 'copy_validation_prompt',
        description: 'Prepare a validation prompt for independent review.',
        requiresHumanApproval: false,
      },
      {
        actionId: 'explain_blocked_action',
        label: 'Explain blocked action',
        actionType: 'explain_blocked_action',
        description: 'Explain why live execution, tools, providers, or Auto Mode are blocked.',
        requiresHumanApproval: false,
      },
    ]

    if (executionPlan.blockedReason || executionPlan.fallbackPlan.strategy === 'ask_clarification') {
      actions.push({
        actionId: 'ask_clarification',
        label: 'Ask clarification',
        actionType: 'ask_clarification',
        description: 'Ask the operator to clarify the dry-run request before any future execution phase.',
        requiresHumanApproval: false,
      })
    }

    if (executionPlan.approvalRequired || gateDecision.requiredApprovals.length > 0) {
      actions.push({
        actionId: 'request_operator_approval',
        label: 'Request operator approval',
        actionType: 'request_operator_approval',
        description: 'Request approval for a future execution phase; does not execute in 46F.',
        requiresHumanApproval: true,
      })
    }

    actions.push({
      actionId: 'queue_for_future_execution',
      label: 'Queue for future execution',
      actionType: 'queue_for_future_execution',
      description: 'Mark as eligible for a future phase queue without writing to a live queue in 46F.',
      requiresHumanApproval: true,
    })

    return actions
  }
}
