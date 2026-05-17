export type BackgroundWorkerKind =
  | 'provider_health'
  | 'source_freshness'
  | 'finance_monitoring'
  | 'local_alerts'
  | 'opportunity_changes'
  | 'repair_monitoring'
  | 'anomaly_detection'
  | 'queue_monitoring'
  | 'environmental_changes'

export type BackgroundWorkerPlan = {
  id: string
  kind: BackgroundWorkerKind
  label: string
  cadenceMinutes: number
  health: 'ready' | 'watch' | 'paused'
  observes: string[]
  emits: string[]
  externalExecutionAllowed: false
  approvalRequiredFor: string[]
}

export const BACKGROUND_WORKER_PLANS: BackgroundWorkerPlan[] = [
  {
    id: 'worker-provider-health',
    kind: 'provider_health',
    label: 'Provider health monitor',
    cadenceMinutes: 30,
    health: 'ready',
    observes: ['provider latency', 'scorecard drift', 'failure rate'],
    emits: ['provider warning', 'routing recommendation'],
    externalExecutionAllowed: false,
    approvalRequiredFor: ['Provider routing changes', 'paid provider expansion'],
  },
  {
    id: 'worker-source-freshness',
    kind: 'source_freshness',
    label: 'Source freshness monitor',
    cadenceMinutes: 60,
    health: 'ready',
    observes: ['source age', 'retrieval failures', 'source overlap'],
    emits: ['freshness warning', 'fallback recommendation'],
    externalExecutionAllowed: false,
    approvalRequiredFor: ['External fetch expansion', 'new paid data source'],
  },
  {
    id: 'worker-repair-monitor',
    kind: 'repair_monitoring',
    label: 'Repair monitoring',
    cadenceMinutes: 15,
    health: 'watch',
    observes: ['repair plan status', 'rollback checkpoint state', 'validation failures'],
    emits: ['repair risk', 'checkpoint reminder'],
    externalExecutionAllowed: false,
    approvalRequiredFor: ['Any code mutation', 'deployment', 'rollback execution'],
  },
  {
    id: 'worker-anomaly-watch',
    kind: 'anomaly_detection',
    label: 'Anomaly detector',
    cadenceMinutes: 20,
    health: 'ready',
    observes: ['outcome anomalies', 'forecast risk', 'queue pressure'],
    emits: ['anomaly alert', 'overnight summary item'],
    externalExecutionAllowed: false,
    approvalRequiredFor: ['Notification delivery beyond local UI', 'external incident response'],
  },
]

export function getBackgroundWorkerPlans(): BackgroundWorkerPlan[] {
  return BACKGROUND_WORKER_PLANS
}

export function getBackgroundWorkerSummary() {
  return {
    total: BACKGROUND_WORKER_PLANS.length,
    ready: BACKGROUND_WORKER_PLANS.filter(worker => worker.health === 'ready').length,
    watching: BACKGROUND_WORKER_PLANS.filter(worker => worker.health === 'watch').length,
    externalExecutionAllowed: BACKGROUND_WORKER_PLANS.some(worker => worker.externalExecutionAllowed),
    rule: 'Workers monitor and recommend only; Commander approval controls external effects.',
  }
}
