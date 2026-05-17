import type { BoundedExecutionPlan } from './boundedExecutionPlanner'

export type AutomationSchedulePreview = {
  planId: string
  cadence: 'manual' | 'on_approval' | 'recurring'
  frequencyPerHour: number
  nextEligibleState: 'awaiting_commander' | 'eligible_for_queue' | 'cooldown' | 'paused'
  queuePressure: BoundedExecutionPlan['throttle']['queuePressure']
  actualExecutionScheduled: false
}

export function previewAutomationSchedule(plan: BoundedExecutionPlan): AutomationSchedulePreview {
  const recurring = plan.modeId === 'bounded_auto' || plan.modeId === 'full_auto_domain'
  const cadence = plan.modeId === 'manual' || plan.modeId === 'assisted'
    ? 'manual'
    : recurring
      ? 'recurring'
      : 'on_approval'
  const nextEligibleState = plan.throttle.state === 'paused' || plan.throttle.state === 'emergency_shutdown'
    ? 'paused'
    : plan.throttle.state === 'cooldown'
      ? 'cooldown'
      : plan.policy.status === 'commander_review_required'
        ? 'awaiting_commander'
        : 'eligible_for_queue'

  return {
    planId: plan.id,
    cadence,
    frequencyPerHour: recurring ? plan.throttle.maxConcurrent : 0,
    nextEligibleState,
    queuePressure: plan.throttle.queuePressure,
    actualExecutionScheduled: false,
  }
}
