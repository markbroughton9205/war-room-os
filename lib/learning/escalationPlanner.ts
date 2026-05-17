import { detectLearningAnomalies } from './anomalyDetection'
import { getBackgroundWorkerPlans } from './backgroundWorkerCoordinator'

export type EscalationType =
  | 'overnight_summary'
  | 'anomaly_alert'
  | 'critical_warning'
  | 'provider_failure'
  | 'opportunity_spike'
  | 'public_alert'
  | 'repair_failure'

export type EscalationPlan = {
  id: string
  type: EscalationType
  title: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  trigger: string
  recommendedChannel: 'dashboard' | 'local_notification' | 'commander_review'
  commanderControlled: true
  autoSendEnabled: false
}

export function getEscalationPlans(): EscalationPlan[] {
  const anomalies = detectLearningAnomalies()
  const workerPlans = getBackgroundWorkerPlans()

  return [
    {
      id: 'escalation-overnight-summary',
      type: 'overnight_summary',
      title: 'Overnight operational summary',
      priority: 'medium',
      trigger: 'Daily learning, worker, source freshness, and forecast digest.',
      recommendedChannel: 'dashboard',
      commanderControlled: true,
      autoSendEnabled: false,
    },
    {
      id: 'escalation-anomaly-alert',
      type: 'anomaly_alert',
      title: 'Anomaly alert queue',
      priority: anomalies.some(anomaly => anomaly.severity === 'critical') ? 'critical' : 'high',
      trigger: `${anomalies.length} anomaly signals currently classified.`,
      recommendedChannel: 'commander_review',
      commanderControlled: true,
      autoSendEnabled: false,
    },
    {
      id: 'escalation-provider-failure',
      type: 'provider_failure',
      title: 'Provider failure or score drift',
      priority: workerPlans.some(worker => worker.kind === 'provider_health' && worker.health !== 'ready') ? 'high' : 'medium',
      trigger: 'Provider health monitor reports failure, latency, hallucination, or contradiction miss drift.',
      recommendedChannel: 'dashboard',
      commanderControlled: true,
      autoSendEnabled: false,
    },
    {
      id: 'escalation-repair-failure',
      type: 'repair_failure',
      title: 'Repair failure and rollback review',
      priority: 'high',
      trigger: 'Repair validation fails or rollback checkpoint is stale before mutation.',
      recommendedChannel: 'commander_review',
      commanderControlled: true,
      autoSendEnabled: false,
    },
  ]
}

export function getEscalationSummary() {
  const plans = getEscalationPlans()
  return {
    queued: plans.length,
    highOrCritical: plans.filter(plan => plan.priority === 'high' || plan.priority === 'critical').length,
    autoSendEnabled: plans.some(plan => plan.autoSendEnabled),
    commanderControlled: plans.every(plan => plan.commanderControlled),
  }
}
