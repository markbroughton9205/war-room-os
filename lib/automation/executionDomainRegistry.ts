import type { AutomationModeId } from './automationModeRegistry'

export type ExecutionDomainId =
  | 'research_domain'
  | 'analysis_domain'
  | 'lead_generation_domain'
  | 'freight_monitoring_domain'
  | 'market_tracking_domain'
  | 'financial_monitoring_domain'
  | 'workflow_coordination_domain'
  | 'notification_domain'
  | 'deployment_preparation_domain'

export type RiskThreshold = 'low' | 'moderate' | 'elevated' | 'high'
export type QueuePressureState = 'normal' | 'watch' | 'high' | 'paused'

export type FinancialLimits = {
  spendCeilingUsd: number
  recurringLimitUsd: number
  domainBudgetUsd: number
  executionFrequencyPerHour: number
  minimumProfitRiskRatio: number
  maximumRollbackCostUsd: number
  minimumConfidenceScore: number
}

export type ExecutionDomainDefinition = {
  id: ExecutionDomainId
  label: string
  purpose: string
  defaultMode: AutomationModeId
  allowedModes: AutomationModeId[]
  capabilities: string[]
  restrictions: string[]
  escalationRules: string[]
  rollbackBehavior: string
  financialLimits: FinancialLimits
  queueScope: string[]
  riskThreshold: RiskThreshold
  memoryScope: string[]
  throttleProfile: {
    maxConcurrent: number
    cooldownMinutes: number
    maxRetries: number
    failureWindow: number
  }
}

const noSpend: FinancialLimits = {
  spendCeilingUsd: 0,
  recurringLimitUsd: 0,
  domainBudgetUsd: 0,
  executionFrequencyPerHour: 6,
  minimumProfitRiskRatio: 1.5,
  maximumRollbackCostUsd: 0,
  minimumConfidenceScore: 0.72,
}

export const EXECUTION_DOMAINS: ExecutionDomainDefinition[] = [
  {
    id: 'research_domain',
    label: 'Research Domain',
    purpose: 'Gather source-backed evidence, unknowns, and contradictions for Commander-reviewed briefs.',
    defaultMode: 'assisted',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint', 'bounded_auto'],
    capabilities: ['Source retrieval planning', 'Evidence packet preparation', 'Contradiction flagging'],
    restrictions: ['No source purchase', 'No credential access', 'No claim without provenance'],
    escalationRules: ['Escalate stale sources', 'Escalate source contradictions', 'Escalate missing provenance'],
    rollbackBehavior: 'Discard draft packets and mark source set stale; no external rollback is required.',
    financialLimits: noSpend,
    queueScope: ['research_tasks', 'intelligence_retrieval', 'source_review'],
    riskThreshold: 'moderate',
    memoryScope: ['source_reliability', 'local_intelligence', 'doctrine'],
    throttleProfile: { maxConcurrent: 3, cooldownMinutes: 10, maxRetries: 2, failureWindow: 3 },
  },
  {
    id: 'analysis_domain',
    label: 'Analysis Domain',
    purpose: 'Convert evidence and operational history into scored recommendations and review packets.',
    defaultMode: 'assisted',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint', 'bounded_auto'],
    capabilities: ['Risk scoring', 'Forecast comparison', 'Opportunity ranking'],
    restrictions: ['No final action', 'No silent promotion of recommendations', 'No unsupported confidence boost'],
    escalationRules: ['Escalate confidence below threshold', 'Escalate high-risk recommendations'],
    rollbackBehavior: 'Invalidate derived scorecards and require refreshed evidence before reuse.',
    financialLimits: { ...noSpend, executionFrequencyPerHour: 4, minimumConfidenceScore: 0.76 },
    queueScope: ['analysis_tasks', 'forecast_review', 'opportunity_scoring'],
    riskThreshold: 'moderate',
    memoryScope: ['forecast_feedback', 'economic_opportunities', 'doctrine'],
    throttleProfile: { maxConcurrent: 2, cooldownMinutes: 15, maxRetries: 2, failureWindow: 3 },
  },
  {
    id: 'lead_generation_domain',
    label: 'Lead Generation Domain',
    purpose: 'Prepare prospecting queues and opportunity routes without spending or contacting leads autonomously.',
    defaultMode: 'approval_checkpoint',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint', 'bounded_auto'],
    capabilities: ['Lead queue preparation', 'Fit scoring', 'Commander handoff packets'],
    restrictions: ['No outreach send', 'No paid lead purchase', 'No CRM mutation without approval'],
    escalationRules: ['Escalate paid data requests', 'Escalate repeated duplicate leads', 'Escalate low confidence lead batches'],
    rollbackBehavior: 'Quarantine generated lead batch and remove it from routing views.',
    financialLimits: { ...noSpend, spendCeilingUsd: 25, recurringLimitUsd: 0, domainBudgetUsd: 100, minimumProfitRiskRatio: 2.5, maximumRollbackCostUsd: 10 },
    queueScope: ['lead_generation', 'opportunity_routing', 'commander_handoff'],
    riskThreshold: 'moderate',
    memoryScope: ['economic_opportunities', 'workflow_history', 'source_reliability'],
    throttleProfile: { maxConcurrent: 1, cooldownMinutes: 30, maxRetries: 1, failureWindow: 2 },
  },
  {
    id: 'freight_monitoring_domain',
    label: 'Freight Monitoring Domain',
    purpose: 'Track freight lanes, pricing signals, and route reliability for reviewable alerts.',
    defaultMode: 'bounded_auto',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint', 'bounded_auto'],
    capabilities: ['Lane signal monitoring', 'Rate movement alerts', 'Reliability comparison'],
    restrictions: ['No booking', 'No carrier commitment', 'No spend authorization'],
    escalationRules: ['Escalate rate anomalies', 'Escalate low reliability sources', 'Escalate operational commitments'],
    rollbackBehavior: 'Revoke alert batch and require lane snapshot refresh.',
    financialLimits: { ...noSpend, executionFrequencyPerHour: 8, minimumProfitRiskRatio: 2 },
    queueScope: ['freight_monitoring', 'market_signals', 'alert_review'],
    riskThreshold: 'moderate',
    memoryScope: ['freight_intelligence', 'market_signals', 'source_reliability'],
    throttleProfile: { maxConcurrent: 2, cooldownMinutes: 10, maxRetries: 2, failureWindow: 3 },
  },
  {
    id: 'market_tracking_domain',
    label: 'Market Tracking Domain',
    purpose: 'Monitor market movement and source freshness for routed opportunities.',
    defaultMode: 'bounded_auto',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint', 'bounded_auto'],
    capabilities: ['Market watchlists', 'Trend deltas', 'Signal decay detection'],
    restrictions: ['No trade execution', 'No paid subscription changes', 'No unsourced market claims'],
    escalationRules: ['Escalate contradiction spikes', 'Escalate stale market doctrine', 'Escalate unusual volatility'],
    rollbackBehavior: 'Pause affected watchlist and label generated recommendations degraded.',
    financialLimits: { ...noSpend, executionFrequencyPerHour: 10, minimumProfitRiskRatio: 2 },
    queueScope: ['market_tracking', 'opportunity_tracking', 'signal_review'],
    riskThreshold: 'moderate',
    memoryScope: ['market_signals', 'forecast_feedback', 'source_reliability'],
    throttleProfile: { maxConcurrent: 2, cooldownMinutes: 8, maxRetries: 2, failureWindow: 3 },
  },
  {
    id: 'financial_monitoring_domain',
    label: 'Financial Monitoring Domain',
    purpose: 'Watch financial guardrails, budgets, and expected gain versus risk without initiating spend.',
    defaultMode: 'approval_checkpoint',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint'],
    capabilities: ['Budget checks', 'Spend ceiling validation', 'Profit/risk comparison'],
    restrictions: ['No payment initiation', 'No account changes', 'No recurring charge creation'],
    escalationRules: ['Escalate any spend request', 'Escalate budget breach risk', 'Escalate repeated failed financial checks'],
    rollbackBehavior: 'Block the request, preserve audit trail, and require Commander review before retry.',
    financialLimits: { spendCeilingUsd: 0, recurringLimitUsd: 0, domainBudgetUsd: 0, executionFrequencyPerHour: 3, minimumProfitRiskRatio: 3, maximumRollbackCostUsd: 0, minimumConfidenceScore: 0.82 },
    queueScope: ['financial_monitoring', 'guardrail_review', 'budget_status'],
    riskThreshold: 'elevated',
    memoryScope: ['economic_opportunities', 'workflow_history', 'doctrine'],
    throttleProfile: { maxConcurrent: 1, cooldownMinutes: 30, maxRetries: 1, failureWindow: 2 },
  },
  {
    id: 'workflow_coordination_domain',
    label: 'Workflow Coordination Domain',
    purpose: 'Route internal queues, handoffs, and status packets while keeping mutation approval-bound.',
    defaultMode: 'bounded_auto',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint', 'bounded_auto', 'full_auto_domain'],
    capabilities: ['Internal routing', 'Queue pressure summaries', 'Handoff packet preparation'],
    restrictions: ['No external mutation', 'No approval bypass', 'No hidden queue creation'],
    escalationRules: ['Escalate queue pressure high', 'Escalate stale doctrine', 'Escalate invalid memory scope'],
    rollbackBehavior: 'Pause route, mark queue items needs_review, and restore previous queue ownership.',
    financialLimits: { ...noSpend, executionFrequencyPerHour: 12, minimumConfidenceScore: 0.75 },
    queueScope: ['workflow_coordination', 'agent_handoffs', 'queue_pressure'],
    riskThreshold: 'moderate',
    memoryScope: ['workflow_history', 'doctrine', 'infrastructure_health'],
    throttleProfile: { maxConcurrent: 3, cooldownMinutes: 5, maxRetries: 2, failureWindow: 4 },
  },
  {
    id: 'notification_domain',
    label: 'Notification Domain',
    purpose: 'Prepare and route Commander-visible alerts without silent outbound messaging.',
    defaultMode: 'approval_checkpoint',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint', 'bounded_auto'],
    capabilities: ['Alert drafting', 'Priority sorting', 'Escalation summaries'],
    restrictions: ['No external send without approval', 'No notification spam', 'No hidden recipients'],
    escalationRules: ['Escalate emergency shutdown triggers', 'Escalate repeated notification failures'],
    rollbackBehavior: 'Cancel pending notification batch and annotate the alert source.',
    financialLimits: { ...noSpend, executionFrequencyPerHour: 6, minimumConfidenceScore: 0.78 },
    queueScope: ['notifications', 'commander_alerts', 'escalations'],
    riskThreshold: 'moderate',
    memoryScope: ['workflow_history', 'infrastructure_health', 'doctrine'],
    throttleProfile: { maxConcurrent: 1, cooldownMinutes: 12, maxRetries: 1, failureWindow: 2 },
  },
  {
    id: 'deployment_preparation_domain',
    label: 'Deployment Preparation Domain',
    purpose: 'Prepare deployment plans, readiness checks, and rollback packets without silent deploys.',
    defaultMode: 'assisted',
    allowedModes: ['manual', 'assisted', 'approval_checkpoint'],
    capabilities: ['Deployment checklist preparation', 'Rollback packet planning', 'Readiness summaries'],
    restrictions: ['No deploy execution', 'No production mutation', 'No approval bypass'],
    escalationRules: ['Escalate failed validation', 'Escalate missing rollback', 'Escalate infrastructure contradiction'],
    rollbackBehavior: 'Keep rollback packet attached to the approval request and block execution until reviewed.',
    financialLimits: { ...noSpend, executionFrequencyPerHour: 2, minimumConfidenceScore: 0.86 },
    queueScope: ['deployment_preparation', 'engineering_bridge', 'rollback_planning'],
    riskThreshold: 'high',
    memoryScope: ['engineering_bridge', 'repair_ledger', 'infrastructure_health', 'doctrine'],
    throttleProfile: { maxConcurrent: 1, cooldownMinutes: 60, maxRetries: 1, failureWindow: 1 },
  },
]

export function getExecutionDomains() {
  return EXECUTION_DOMAINS
}

export function getExecutionDomain(id: ExecutionDomainId) {
  return EXECUTION_DOMAINS.find(domain => domain.id === id)
}
