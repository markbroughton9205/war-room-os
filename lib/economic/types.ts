import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export const ECONOMIC_OPERATIONAL_DOMAINS = [
  'income_ops',
  'freight_ops',
  'lead_ops',
  'research_ops',
  'automation_ops',
  'intelligence_ops',
  'build_ops',
  'media_ops',
  'acquisition_ops',
  'sales_ops',
  'client_ops',
  'market_ops',
] as const

export type EconomicOperationalDomainId = (typeof ECONOMIC_OPERATIONAL_DOMAINS)[number]

export const ECONOMIC_WORKFLOW_TYPES = [
  'leads',
  'proposals',
  'research_targets',
  'outreach_drafts',
  'automation_tasks',
  'intelligence_reports',
  'acquisition_targets',
] as const

export type EconomicWorkflowType = (typeof ECONOMIC_WORKFLOW_TYPES)[number]

export const ECONOMIC_WORKFLOW_STATUSES = [
  'pending',
  'investigating',
  'approved',
  'queued',
  'executing',
  'completed',
  'failed',
  'archived',
] as const
export type EconomicWorkflowStatus = (typeof ECONOMIC_WORKFLOW_STATUSES)[number]

export const ECONOMIC_OPPORTUNITY_STATUSES = [
  'discovered',
  'investigating',
  'approved',
  'queued',
  'executing',
  'completed',
  'rejected',
  'archived',
] as const

export type EconomicOpportunityStatus = (typeof ECONOMIC_OPPORTUNITY_STATUSES)[number]

export const ECONOMIC_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type EconomicRiskLevel = (typeof ECONOMIC_RISK_LEVELS)[number]

export type EconomicFamily = Extract<CouncilOrchestrationFamily, 'chatgpt' | 'claude' | 'grok' | 'gemini' | 'red_team'>

export const ECONOMIC_TELEMETRY_CATEGORIES = [
  'provider_latency',
  'opportunity_count',
  'estimated_value_total',
  'workflow_completion_rate',
  'proposal_generation_volume',
  'provider_success_failure_rate',
  'routing_violation',
  'operational_throughput',
] as const

export type EconomicTelemetryCategory = (typeof ECONOMIC_TELEMETRY_CATEGORIES)[number]

export const ECONOMIC_PROPOSAL_OUTPUT_TYPES = [
  'outreach_draft',
  'sales_proposal',
  'freight_proposal',
  'business_plan',
  'automation_offer',
  'operational_recommendation',
] as const

export type EconomicProposalOutputType = (typeof ECONOMIC_PROPOSAL_OUTPUT_TYPES)[number]

export const ECONOMIC_APPROVAL_ACTIONS = [
  'email',
  'outreach',
  'contract',
  'publishing',
  'payment',
  'account_action',
  'external_submission',
] as const

export type EconomicApprovalAction = (typeof ECONOMIC_APPROVAL_ACTIONS)[number]

export type EconomicOutputStructure = {
  format: 'structured_brief' | 'draft' | 'report' | 'plan' | 'recommendation'
  requiredFields: readonly string[]
  approvalGate: 'human_required'
}

export type EconomicDomainRegistryEntry = {
  id: EconomicOperationalDomainId
  label: string
  providerPriority: readonly EconomicFamily[]
  workflowType: EconomicWorkflowType
  allowedTools: readonly string[]
  approvalRequirements: readonly EconomicApprovalAction[]
  telemetryCategory: EconomicTelemetryCategory
  outputStructure: EconomicOutputStructure
}

export type EconomicOpportunity = {
  id: string
  title: string
  category: EconomicOperationalDomainId
  source: string
  source_provider: EconomicFamily | 'unknown'
  confidence: number
  estimated_value: number | null
  assigned_family: EconomicFamily
  required_actions: readonly string[]
  risk_level: EconomicRiskLevel
  notes: string
  source_details: Record<string, unknown>
  status: EconomicOpportunityStatus
  discovered_at: string
  expires_at: string | null
  dedupe_key: string
  metadata?: Record<string, unknown>
}

export type EconomicWorkflowQueueItem = {
  id: string
  workflow_type: EconomicWorkflowType
  status: EconomicWorkflowStatus
  assigned_family: EconomicFamily
  priority: number
  created_at: string
  updated_at: string
  summary: string
  domain_id: EconomicOperationalDomainId
  approval_required: true
  metadata?: Record<string, unknown>
}

export type EconomicProposal = {
  id: string
  output_type: EconomicProposalOutputType
  status: 'drafted' | 'approved' | 'rejected' | 'archived'
  assigned_family: EconomicFamily
  workflow_id: string | null
  opportunity_id: string | null
  title: string
  body: string
  approval_required: true
  external_use_approved_at: string | null
  created_at: string
  updated_at: string
  metadata?: Record<string, unknown>
}

export type EconomicTelemetryEvent = {
  id: string
  category: EconomicTelemetryCategory
  provider_family: EconomicFamily | null
  domain_id: EconomicOperationalDomainId | null
  metric_name: string
  metric_value: number
  recorded_at: string
  metadata?: Record<string, unknown>
}

export type ProviderEffectivenessSnapshot = {
  provider_family: EconomicFamily
  success_count: number
  failure_count: number
  average_latency_ms: number | null
  routing_violation_count: number
  updated_at: string
}

export type ActiveEconomicMission = {
  id: string
  title: string
  domain_id: EconomicOperationalDomainId
  assigned_family: EconomicFamily
  status: 'pending' | 'investigating' | 'approved' | 'queued' | 'executing' | 'completed' | 'archived'
  approval_required: true
  last_activity_at: string
  created_at: string
  updated_at: string
  metadata?: Record<string, unknown>
}

export type EconomicAssignmentHistory = {
  id: string
  subject_type: 'opportunity' | 'workflow' | 'proposal' | 'mission'
  subject_id: string
  assigned_family: EconomicFamily
  provider_runtime_state: 'recommended' | 'assigned' | 'investigating' | 'waiting_approval' | 'completed' | 'blocked'
  confidence: number
  last_activity_at: string
  created_at: string
  metadata?: Record<string, unknown>
}

export type UnresolvedEconomicOperation = {
  id: string
  domain_id: EconomicOperationalDomainId
  workflow_id: string | null
  opportunity_id: string | null
  reason: string
  severity: EconomicRiskLevel
  status: 'open' | 'reviewing' | 'resolved' | 'archived'
  created_at: string
  updated_at: string
  metadata?: Record<string, unknown>
}
