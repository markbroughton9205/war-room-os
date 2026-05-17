import type { BoundedExecutionPlan } from './boundedExecutionPlanner'

export type AutomationAuditEvent = {
  id: string
  planId: string
  domainId: BoundedExecutionPlan['domainId']
  eventType:
    | 'mode_assigned'
    | 'domain_registered'
    | 'simulation_recorded'
    | 'checkpoint_evaluated'
    | 'policy_decided'
    | 'throttle_evaluated'
    | 'rollback_planned'
    | 'escalation_planned'
  severity: 'info' | 'watch' | 'warning' | 'critical'
  summary: string
  reconstructable: true
  actualExecutionPerformed: false
}

export function createAutomationAuditTrail(plans: BoundedExecutionPlan[]): AutomationAuditEvent[] {
  return plans.flatMap((plan) => {
    const severity: AutomationAuditEvent['severity'] = plan.checkpoint.decision === 'blocked'
      ? 'critical'
      : plan.checkpoint.decision === 'needs_review' || plan.throttle.state !== 'open'
        ? 'watch'
        : 'info'
    return [
      {
        id: `${plan.id}:mode`,
        planId: plan.id,
        domainId: plan.domainId,
        eventType: 'mode_assigned',
        severity: 'info',
        summary: `${plan.modeId} assigned to ${plan.domainId}.`,
        reconstructable: true,
        actualExecutionPerformed: false,
      },
      {
        id: `${plan.id}:simulation`,
        planId: plan.id,
        domainId: plan.domainId,
        eventType: 'simulation_recorded',
        severity,
        summary: plan.simulation.expectedRisk,
        reconstructable: true,
        actualExecutionPerformed: false,
      },
      {
        id: `${plan.id}:checkpoint`,
        planId: plan.id,
        domainId: plan.domainId,
        eventType: 'checkpoint_evaluated',
        severity,
        summary: `Checkpoint decision: ${plan.checkpoint.decision}.`,
        reconstructable: true,
        actualExecutionPerformed: false,
      },
      {
        id: `${plan.id}:rollback`,
        planId: plan.id,
        domainId: plan.domainId,
        eventType: 'rollback_planned',
        severity: plan.rollback.rollbackReady ? 'info' : 'warning',
        summary: `Rollback complexity ${plan.rollback.complexity}; estimated cost $${plan.rollback.estimatedCostUsd}.`,
        reconstructable: true,
        actualExecutionPerformed: false,
      },
    ]
  })
}
