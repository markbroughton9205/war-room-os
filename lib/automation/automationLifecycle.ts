import type { BoundedExecutionPlan } from './boundedExecutionPlanner'

export type AutomationLifecycleState = {
  planId: string
  state: 'draft' | 'ready_for_commander_review' | 'blocked' | 'degraded' | 'paused'
  commanderAuthority: 'required'
  revocable: true
  actualExecutionActive: false
  notes: string[]
}

export function deriveAutomationLifecycle(plans: BoundedExecutionPlan[]): AutomationLifecycleState[] {
  return plans.map((plan) => {
    const state: AutomationLifecycleState['state'] = plan.policy.status === 'blocked'
      ? 'blocked'
      : plan.throttle.state === 'paused' || plan.throttle.state === 'emergency_shutdown'
        ? 'paused'
        : plan.checkpoint.decision === 'degraded' || plan.checkpoint.decision === 'needs_review'
          ? 'degraded'
          : plan.policy.status === 'commander_review_required'
            ? 'ready_for_commander_review'
            : 'draft'

    return {
      planId: plan.id,
      state,
      commanderAuthority: 'required',
      revocable: true,
      actualExecutionActive: false,
      notes: [
        `Policy ${plan.policy.status}`,
        `Checkpoint ${plan.checkpoint.decision}`,
        `Throttle ${plan.throttle.state}`,
      ],
    }
  })
}
