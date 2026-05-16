import type { EconomicDomainRegistryEntry, EconomicOperationalDomainId } from '@/lib/economic/types'

const APPROVAL_ALL_EXTERNAL = [
  'email',
  'outreach',
  'contract',
  'publishing',
  'payment',
  'account_action',
  'external_submission',
] as const

export const ECONOMIC_DOMAIN_REGISTRY: readonly EconomicDomainRegistryEntry[] = [
  {
    id: 'income_ops',
    label: 'Income Operations',
    providerPriority: ['grok', 'chatgpt', 'gemini', 'claude', 'red_team'],
    workflowType: 'leads',
    allowedTools: ['internal_registry', 'market_research_notes', 'opportunity_scoring'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'opportunity_count',
    outputStructure: {
      format: 'structured_brief',
      requiredFields: ['title', 'source', 'estimated_value', 'risk_level', 'required_actions'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'freight_ops',
    label: 'Freight Operations',
    providerPriority: ['grok', 'gemini', 'chatgpt', 'red_team', 'claude'],
    workflowType: 'research_targets',
    allowedTools: ['freight_lane_research', 'demand_notes', 'risk_review'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'estimated_value_total',
    outputStructure: {
      format: 'report',
      requiredFields: ['lane', 'demand_signal', 'estimated_value', 'risk_level', 'next_review'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'lead_ops',
    label: 'Lead Operations',
    providerPriority: ['grok', 'chatgpt', 'gemini', 'red_team', 'claude'],
    workflowType: 'leads',
    allowedTools: ['lead_research_notes', 'fit_scoring', 'approval_queue'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'operational_throughput',
    outputStructure: {
      format: 'structured_brief',
      requiredFields: ['lead_segment', 'source', 'confidence', 'recommended_follow_up'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'research_ops',
    label: 'Research Operations',
    providerPriority: ['gemini', 'grok', 'claude', 'chatgpt', 'red_team'],
    workflowType: 'research_targets',
    allowedTools: ['research_brief', 'source_cross_reference', 'gap_analysis'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'provider_latency',
    outputStructure: {
      format: 'report',
      requiredFields: ['question', 'known_signals', 'gaps', 'recommended_sources'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'automation_ops',
    label: 'Automation Operations',
    providerPriority: ['claude', 'chatgpt', 'gemini', 'red_team', 'grok'],
    workflowType: 'automation_tasks',
    allowedTools: ['requirements_brief', 'systems_design', 'implementation_plan'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'workflow_completion_rate',
    outputStructure: {
      format: 'plan',
      requiredFields: ['problem', 'workflow', 'constraints', 'approval_points'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'intelligence_ops',
    label: 'Intelligence Operations',
    providerPriority: ['grok', 'gemini', 'red_team', 'chatgpt', 'claude'],
    workflowType: 'intelligence_reports',
    allowedTools: ['signal_capture', 'cross_reference', 'contradiction_review'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'routing_violation',
    outputStructure: {
      format: 'report',
      requiredFields: ['signal', 'confidence', 'contradictions', 'recommended_watchlist'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'build_ops',
    label: 'Build Operations',
    providerPriority: ['claude', 'chatgpt', 'gemini', 'red_team', 'grok'],
    workflowType: 'automation_tasks',
    allowedTools: ['technical_plan', 'scope_register', 'risk_review'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'provider_success_failure_rate',
    outputStructure: {
      format: 'plan',
      requiredFields: ['scope', 'architecture', 'dependencies', 'acceptance_criteria'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'media_ops',
    label: 'Media Operations',
    providerPriority: ['chatgpt', 'gemini', 'grok', 'red_team', 'claude'],
    workflowType: 'outreach_drafts',
    allowedTools: ['content_brief', 'audience_notes', 'approval_queue'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'proposal_generation_volume',
    outputStructure: {
      format: 'draft',
      requiredFields: ['audience', 'message', 'channel', 'approval_notes'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'acquisition_ops',
    label: 'Acquisition Operations',
    providerPriority: ['grok', 'chatgpt', 'red_team', 'gemini', 'claude'],
    workflowType: 'acquisition_targets',
    allowedTools: ['target_research', 'valuation_notes', 'risk_review'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'estimated_value_total',
    outputStructure: {
      format: 'structured_brief',
      requiredFields: ['target', 'source', 'estimated_value', 'risk_level', 'approval_notes'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'sales_ops',
    label: 'Sales Operations',
    providerPriority: ['chatgpt', 'grok', 'gemini', 'red_team', 'claude'],
    workflowType: 'proposals',
    allowedTools: ['offer_brief', 'proposal_draft', 'approval_queue'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'proposal_generation_volume',
    outputStructure: {
      format: 'draft',
      requiredFields: ['prospect', 'offer', 'terms_placeholder', 'approval_notes'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'client_ops',
    label: 'Client Operations',
    providerPriority: ['chatgpt', 'claude', 'gemini', 'red_team', 'grok'],
    workflowType: 'proposals',
    allowedTools: ['client_brief', 'operational_recommendation', 'approval_queue'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'workflow_completion_rate',
    outputStructure: {
      format: 'recommendation',
      requiredFields: ['client_need', 'recommendation', 'constraints', 'approval_notes'],
      approvalGate: 'human_required',
    },
  },
  {
    id: 'market_ops',
    label: 'Market Operations',
    providerPriority: ['gemini', 'grok', 'chatgpt', 'red_team', 'claude'],
    workflowType: 'research_targets',
    allowedTools: ['market_gap_scan', 'industry_notes', 'opportunity_scoring'],
    approvalRequirements: APPROVAL_ALL_EXTERNAL,
    telemetryCategory: 'opportunity_count',
    outputStructure: {
      format: 'report',
      requiredFields: ['market', 'gap', 'confidence', 'estimated_value', 'recommended_next_step'],
      approvalGate: 'human_required',
    },
  },
] as const

export const ECONOMIC_DOMAIN_REGISTRY_BY_ID: ReadonlyMap<EconomicOperationalDomainId, EconomicDomainRegistryEntry> =
  new Map(ECONOMIC_DOMAIN_REGISTRY.map(entry => [entry.id, entry]))

export function getEconomicDomain(id: EconomicOperationalDomainId): EconomicDomainRegistryEntry {
  const entry = ECONOMIC_DOMAIN_REGISTRY_BY_ID.get(id)
  if (!entry) {
    throw new Error(`Unknown economic operational domain: ${id}`)
  }
  return entry
}
