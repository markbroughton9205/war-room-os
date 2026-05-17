export type AgentLifecycleState = 'proposed' | 'approved' | 'active' | 'paused' | 'degraded' | 'retired'

export type AgentOperationalRole =
  | 'monitoring'
  | 'retrieval'
  | 'analytics'
  | 'forecasting'
  | 'repair_analysis'
  | 'provider_health'
  | 'workflow_coordination'
  | 'engineering_coordination'

export type AgentRiskLevel = 'low' | 'moderate' | 'elevated' | 'high'

export type AgentRiskProfile = {
  level: AgentRiskLevel
  reasons: string[]
  commanderApprovalRequired: true
  externalExecutionAllowed: false
}

export type AgentCapabilityLimit = {
  id: string
  label: string
  allowed: boolean
  approvalRequiredForExpansion: true
}

export type AgentMemoryDomain =
  | 'local_intelligence'
  | 'market_signals'
  | 'freight_intelligence'
  | 'repair_ledger'
  | 'forecast_feedback'
  | 'infrastructure_health'
  | 'source_reliability'
  | 'economic_opportunities'
  | 'workflow_history'
  | 'engineering_bridge'
  | 'doctrine'

export type AgentPerformanceMetrics = {
  accuracy: number
  usefulness: number
  contradictionRate: number
  hallucinationIndicators: number
  successfulForecasts: number
  operationalContribution: number
  latencyMs: number
  retrievalQuality: number
  approvalSuccessRate: number
}

export type AgentActivityEvent = {
  at: string
  kind: 'proposal' | 'approval' | 'activation' | 'pause' | 'degradation' | 'retirement' | 'coordination' | 'scorecard'
  summary: string
  metadata?: Record<string, unknown>
}

export type AgentApprovalRecord = {
  at: string
  by: string
  decision: 'approved' | 'rejected' | 'paused' | 'retired' | 'capability_expansion_approved'
  note: string
}

export type AgentBlueprint = {
  id: string
  name: string
  purpose: string
  operationalRole: AgentOperationalRole
  assignedDoctrine: string[]
  memoryScope: AgentMemoryDomain[]
  capabilityLimitIds: string[]
  riskProfile: AgentRiskProfile
  defaultState: AgentLifecycleState
}

export type FoundryAgent = {
  id: string
  blueprintId: string
  name: string
  purpose: string
  state: AgentLifecycleState
  operationalRole: AgentOperationalRole
  assignedDoctrine: string[]
  memoryScope: AgentMemoryDomain[]
  capabilityLimits: AgentCapabilityLimit[]
  performanceHistory: AgentPerformanceMetrics[]
  approvalHistory: AgentApprovalRecord[]
  riskProfile: AgentRiskProfile
  activityHistory: AgentActivityEvent[]
  createdAt: string
  updatedAt: string
}

export type WorkerKind =
  | 'monitoring'
  | 'retrieval'
  | 'analytics'
  | 'local_intelligence'
  | 'opportunity_tracking'
  | 'forecasting'
  | 'repair_monitoring'
  | 'provider_health'
  | 'workflow_coordination'

export type DurableWorker = {
  id: string
  name: string
  kind: WorkerKind
  assignedAgentBlueprintId: string
  state: 'idle' | 'ready' | 'working' | 'paused' | 'degraded'
  queueDepth: number
  memoryScope: AgentMemoryDomain[]
  operationalHistory: AgentActivityEvent[]
  externalExecutionAllowed: false
  persistence: 'persistent_store' | 'awaiting_data' | 'not_connected'
}

export type AgentQueueItem = {
  id: string
  sourceAgentId: string
  targetAgentId: string
  kind: 'analysis_request' | 'review_request' | 'coordination_note' | 'governance_review'
  status: 'queued' | 'in_review' | 'blocked' | 'completed'
  payload: Record<string, unknown>
  createdAt: string
}

export type AgentFoundryTableName =
  | 'war_room_agents'
  | 'war_room_agent_worker_queues'
  | 'war_room_agent_lifecycle_states'
  | 'war_room_agent_memory_scopes'
  | 'war_room_agent_performance_history'
  | 'war_room_agent_governance_events'
  | 'war_room_agent_approvals'
  | 'war_room_agent_degradation_history'

const approvalBoundRisk: AgentRiskProfile = {
  level: 'moderate',
  reasons: ['Persistent worker identity', 'Scoped memory access', 'Operational recommendations require review'],
  commanderApprovalRequired: true,
  externalExecutionAllowed: false,
}

export const AGENT_BLUEPRINTS: AgentBlueprint[] = [
  {
    id: 'local-intelligence-scout',
    name: 'Local Intelligence Scout',
    purpose: 'Monitor local opportunity signals, source freshness, and contradiction pressure.',
    operationalRole: 'retrieval',
    assignedDoctrine: ['runtime-truth', 'retrieval-before-synthesis', 'approval-before-action'],
    memoryScope: ['local_intelligence', 'source_reliability', 'economic_opportunities', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'rank_sources', 'draft_briefings'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'market-monitor',
    name: 'Market Monitor',
    purpose: 'Track market shifts and opportunity drift for Commander-reviewed recommendations.',
    operationalRole: 'monitoring',
    assignedDoctrine: ['runtime-truth', 'no-autonomous-spend', 'approval-before-action'],
    memoryScope: ['market_signals', 'forecast_feedback', 'source_reliability', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'forecast_risk', 'prepare_escalations'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'freight-intelligence-analyst',
    name: 'Freight Intelligence Analyst',
    purpose: 'Analyze freight lanes, reliability signals, and operational opportunity context.',
    operationalRole: 'analytics',
    assignedDoctrine: ['source-backed-confidence', 'approval-before-action'],
    memoryScope: ['freight_intelligence', 'market_signals', 'economic_opportunities', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'rank_sources', 'draft_briefings'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'repair-analyst',
    name: 'Repair Analyst',
    purpose: 'Watch repair history, validation failures, rollback posture, and unresolved risks.',
    operationalRole: 'repair_analysis',
    assignedDoctrine: ['rollback-before-repair', 'approval-before-mutation', 'runtime-truth'],
    memoryScope: ['repair_ledger', 'engineering_bridge', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'diagnose_failures', 'draft_repair_plans'],
    riskProfile: { ...approvalBoundRisk, level: 'elevated', reasons: [...approvalBoundRisk.reasons, 'Adjacent to code mutation workflows'] },
    defaultState: 'proposed',
  },
  {
    id: 'forecast-analyst',
    name: 'Forecast Analyst',
    purpose: 'Compare forecasts against feedback and flag variance without initiating action.',
    operationalRole: 'forecasting',
    assignedDoctrine: ['forecast-is-support', 'runtime-truth', 'approval-before-action'],
    memoryScope: ['forecast_feedback', 'market_signals', 'economic_opportunities', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'forecast_risk', 'draft_briefings'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'infrastructure-monitor',
    name: 'Infrastructure Monitor',
    purpose: 'Monitor provider, worker, and runtime health for degraded lanes and queue pressure.',
    operationalRole: 'provider_health',
    assignedDoctrine: ['runtime-truth', 'resource-aware-workers', 'approval-before-action'],
    memoryScope: ['infrastructure_health', 'source_reliability', 'workflow_history', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'monitor_health', 'prepare_escalations'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'source-reliability-analyst',
    name: 'Source Reliability Analyst',
    purpose: 'Evaluate retrieval quality, source conflict, freshness, and reliability rankings.',
    operationalRole: 'retrieval',
    assignedDoctrine: ['retrieval-before-synthesis', 'contradiction-escalation', 'runtime-truth'],
    memoryScope: ['source_reliability', 'local_intelligence', 'market_signals', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'rank_sources', 'flag_contradictions'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'economic-opportunity-scout',
    name: 'Economic Opportunity Scout',
    purpose: 'Track income opportunities and operational fit while keeping execution approval-bound.',
    operationalRole: 'analytics',
    assignedDoctrine: ['no-autonomous-spend', 'approval-before-action', 'source-backed-confidence'],
    memoryScope: ['economic_opportunities', 'market_signals', 'workflow_history', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'rank_opportunities', 'draft_briefings'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'workflow-optimization-analyst',
    name: 'Workflow Optimization Analyst',
    purpose: 'Watch workflow outcomes, queue pressure, and handoff friction for reviewable improvements.',
    operationalRole: 'workflow_coordination',
    assignedDoctrine: ['approval-before-action', 'outcome-ledger-first', 'runtime-truth'],
    memoryScope: ['workflow_history', 'forecast_feedback', 'economic_opportunities', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'route_internal_tasks', 'draft_briefings'],
    riskProfile: approvalBoundRisk,
    defaultState: 'proposed',
  },
  {
    id: 'engineering-coordination-agent',
    name: 'Engineering Coordination Agent',
    purpose: 'Coordinate repair analysis, Red Team review, and engineering bridge context without mutating code autonomously.',
    operationalRole: 'engineering_coordination',
    assignedDoctrine: ['approval-before-mutation', 'rollback-before-repair', 'runtime-truth'],
    memoryScope: ['engineering_bridge', 'repair_ledger', 'workflow_history', 'doctrine'],
    capabilityLimitIds: ['read_scoped_memory', 'route_internal_tasks', 'draft_repair_plans'],
    riskProfile: { ...approvalBoundRisk, level: 'high', reasons: [...approvalBoundRisk.reasons, 'Coordinates engineering work and repair review'] },
    defaultState: 'proposed',
  },
]

export const AGENT_FOUNDRY_TABLES: AgentFoundryTableName[] = [
  'war_room_agents',
  'war_room_agent_worker_queues',
  'war_room_agent_lifecycle_states',
  'war_room_agent_memory_scopes',
  'war_room_agent_performance_history',
  'war_room_agent_governance_events',
  'war_room_agent_approvals',
  'war_room_agent_degradation_history',
]
