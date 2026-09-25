import type { ResearchDomain, SourceAuthorityClass } from '@/lib/browser-broker/researchPolicy'
import type { ResearchSourceType } from '@/lib/browser-broker/researchDiscovery'
import type { EngineReceipt, StopConditionState, ToolEconomyHints } from '../types'

export type DiscoveryAuthorityRequirement = 'primary' | 'authoritative' | 'any'

export type ResearchDiscoveryInput = {
  mission_id: string
  question: string
  research_domain?: ResearchDomain
  authority_requirement?: DiscoveryAuthorityRequirement
  freshness_window?: { days: number } | null
  known_sources?: readonly string[]
  known_evidence?: readonly string[]
  excluded_domains?: readonly string[]
  preferred_domains?: readonly string[]
  candidate_budget?: number
  retry_budget?: number
}

export type ResearchDiscoveryPlan = {
  normalized_question: string
  domain: ResearchDomain
  primary_queries: string[]
  alternate_queries: string[]
  preferred_source_classes: SourceAuthorityClass[]
  required_freshness: { window_days: number | null; strict: boolean }
  candidate_budget: number
  retry_budget: number
  stop_conditions: StopConditionState[]
  recovery_strategy: 'retry_alternate_query' | 'relax_to_authoritative' | 'honest_failure'
} & ToolEconomyHints

export type EngineSourceCandidate = {
  candidate_id: string
  url: string
  canonical_url: string
  title: string
  domain: string
  source_class: SourceAuthorityClass
  source_type: ResearchSourceType
  query: string
  discovery_method: 'search' | 'seed' | 'alternate'
  rank: number
  paper_identity: string
  duplicate_group: string
  discovered_at: string
  freshness_hint: 'IN_WINDOW' | 'OUT_OF_WINDOW' | 'DATE_UNKNOWN' | null
  authority_hint: SourceAuthorityClass
  relevance_hint: number | null
}

export type ResearchDiscoveryResult = {
  plan: ResearchDiscoveryPlan
  candidates: EngineSourceCandidate[]
  receipt: EngineReceipt
}

export type DiscoveryStopInput = {
  usable_count: number
  independent_count: number
  primary_count: number
  inspected_count: number
  candidate_budget: number
  freshness_skips: number
  remaining_ms: number
  min_usable: number
  required_freshness: boolean
  tool_budget_exhausted?: boolean
  last_accepted?: boolean
}
