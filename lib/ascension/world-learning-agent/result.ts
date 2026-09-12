/**
 * #22 Phase 13 — WORLD_LEARNING_AGENT result contracts. No hidden CoT.
 */
import type { FreshnessState } from '@/lib/war-room-search/crawler/types'
import type { WorldLearningAgentIdentity } from './identity'
import type { WorldLearningAgentScope } from './scope'
import type { WorldLearningAgentTaskType } from './profile'

export const WORLD_LEARNING_AGENT_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DENIED',
  'FAILED',
  'INSUFFICIENT_EVIDENCE',
  'OFFLINE',
  'INTERNAL_ERROR',
] as const
export type WorldLearningAgentStatus = (typeof WORLD_LEARNING_AGENT_STATUSES)[number]

export const WORLD_CLAIM_STATUSES = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'DISPUTED',
  'UNVERIFIED',
  'STALE',
  'SUPERSEDED',
  'INSUFFICIENT_EVIDENCE',
] as const
export type WorldClaimStatus = (typeof WORLD_CLAIM_STATUSES)[number]

export const WORLD_NOVELTY_STATES = [
  'NEW',
  'DUPLICATE',
  'UPDATE',
  'CONFLICT',
  'SUPERSEDES',
  'RELATED',
] as const
export type WorldNoveltyState = (typeof WORLD_NOVELTY_STATES)[number]

export const WORLD_CORPUS_DISPOSITIONS = [
  'RECOMMEND_ADD',
  'RECOMMEND_UPDATE',
  'RECOMMEND_REJECT',
  'REQUIRES_REVIEW',
  'INSUFFICIENT_EVIDENCE',
] as const
export type WorldCorpusDisposition = (typeof WORLD_CORPUS_DISPOSITIONS)[number]

export const WORLD_MEMORY_CLASSES = [
  'WORLD_KNOWLEDGE',
  'COMMANDER_PRIVATE',
  'SESSION_LOCAL',
  'REMOTE_USER_DATA',
] as const
export type WorldMemoryClass = (typeof WORLD_MEMORY_CLASSES)[number]

export const WORLD_SOURCE_CLASSES = [
  'PRIMARY',
  'SECONDARY',
  'OFFICIAL',
  'UNOFFICIAL',
  'LOCAL_INDEX',
  'CACHED',
  'LIVE',
  'FIXTURE',
] as const
export type WorldSourceClass = (typeof WORLD_SOURCE_CLASSES)[number]

export const LIVE_DISCOVERY_STATES = ['AVAILABLE', 'UNAVAILABLE'] as const
export type LiveDiscoveryState = (typeof LIVE_DISCOVERY_STATES)[number]

export type WorldLearningAgentDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type WorldSourceQuality = {
  primary_vs_secondary: 'PRIMARY' | 'SECONDARY' | 'UNKNOWN'
  official_vs_unofficial: 'OFFICIAL' | 'UNOFFICIAL' | 'UNKNOWN'
  recency: FreshnessState
  specificity: 'HIGH' | 'MEDIUM' | 'LOW'
  corroboration: 'CORROBORATED' | 'SINGLE_SOURCE' | 'CONFLICTING'
  historical_reliability: 'KNOWN' | 'UNKNOWN'
  observation_vs_interpretation: 'DIRECT_OBSERVATION' | 'INTERPRETATION' | 'UNKNOWN'
  known_conflicts: boolean
  coverage_limitations: string[]
}

export type WorldLearnedSource = {
  source_id: string
  title: string
  url: string | null
  source_class: WorldSourceClass
  retrieval_time: string
  publication_time: string | null
  live_cached_local: 'LIVE' | 'CACHED' | 'LOCAL' | 'FIXTURE'
  freshness: FreshnessState
  quality: WorldSourceQuality
  evidence_id: string
}

export type WorldLearnedClaim = {
  claim_id: string
  normalized_statement: string
  topic: string
  domain: string | null
  supporting_evidence: string[]
  contradicting_evidence: string[]
  confidence: number
  freshness: FreshnessState
  provenance: {
    source_ids: string[]
    source_classes: WorldSourceClass[]
    retrieval_times: string[]
    evidence_ids: string[]
  }
  status: WorldClaimStatus
  novelty: WorldNoveltyState
  model_generated: false
}

export type WorldLearnedEntity = {
  entity_id: string
  label: string
  entity_type: string
  evidence_ids: string[]
}

export type WorldLearnedRelationship = {
  relationship_id: string
  from_label: string
  relation: string
  to_label: string
  evidence_ids: string[]
}

export type WorldTopicMap = {
  topic: string
  subtopics: string[]
  entities: string[]
  relationships: string[]
  open_questions: string[]
  known_conflicts: string[]
  source_coverage: string[]
  knowledge_gaps: string[]
  bounded: true
}

export type WorldKnowledgeGap = {
  gap_id: string
  gap_type: string
  detail: string
  follow_up_recommended: boolean
  auto_launched: false
}

export type WorldCorpusHandoffCandidate = {
  candidate_id: string
  claim_or_topic: string
  normalized_content: string
  evidence_ids: string[]
  provenance: WorldLearnedClaim['provenance']
  confidence: number
  freshness: FreshnessState
  novelty_state: WorldNoveltyState
  conflict_state: 'NONE' | 'DISPUTED' | 'CONFLICTING'
  recommended_disposition: WorldCorpusDisposition
}

export type WorldLearningAgentResult = {
  agent_id: string
  agent_role: 'WORLD_LEARNING_AGENT'
  status: WorldLearningAgentStatus
  task_type: WorldLearningAgentTaskType
  scope: WorldLearningAgentScope
  summary: string
  topic: string
  domain: string | null
  sources: WorldLearnedSource[]
  claims: WorldLearnedClaim[]
  entities: WorldLearnedEntity[]
  relationships: WorldLearnedRelationship[]
  topic_map: WorldTopicMap | null
  knowledge_gaps: WorldKnowledgeGap[]
  corpus_handoff: WorldCorpusHandoffCandidate[]
  research_agent_invoked: boolean
  search_reused: true
  terra_reused: boolean
  data_corpus_agent_invoked: boolean
  council_validator_invoked: boolean
  live_discovery: LiveDiscoveryState
  terra_freshness_label: 'LIVE' | 'CACHED' | 'STALE' | 'UNKNOWN' | null
  memory_class: WorldMemoryClass
  local_model_used: boolean
  local_model_is_primary_evidence: false
  external_model_is_primary_evidence: false
  autonomous_corpus_persistence: false
  production_corpus_persisted: false
  model_training: 'NOT_IMPLEMENTED'
  wr_corpus: 'NOT_STARTED'
  wr_tokenizer: 'NOT_STARTED'
  wrim: 'NOT_IMPLEMENTED'
  rael: 'NOT_IMPLEMENTED'
  execution_authority: false
  denials: WorldLearningAgentDenial[]
  limitations: string[]
  unavailable_capabilities: string[]
  audit_id: string | null
  started_at: string
  completed_at: string
  owner_scope: string
  mission_id: string | null
  conversation_id: string | null
  identity: WorldLearningAgentIdentity
  boundary_notes: readonly string[]
  roadmap_23_status: 'NOT_STARTED'
}

export const WORLD_LEARNING_AGENT_BOUNDARY_NOTES = Object.freeze([
  'WORLD_LEARNING_AGENT != RESEARCH_AGENT',
  'WORLD_LEARNING_AGENT != DATA_CORPUS_AGENT',
  'WORLD_LEARNING_AGENT != WR-CORPUS',
  'WORLD_LEARNING_AGENT != WR-TOKENIZER',
  'WORLD_LEARNING_AGENT != WRIM',
  'WORLD_LEARNING_AGENT != RAEL',
  'UNDERSTANDING != EXECUTION',
  'MODEL OUTPUT != EVIDENCE',
  'CANDIDATE != PRODUCTION CORPUS',
  'RECOMMENDATION != PERSISTENCE',
  'COUNCIL VALIDATOR != EXECUTION',
  'TERRA = ORACLE, NOT DUPLICATED',
  'SEARCH STAGES 2-5 REUSED, NOT REPLACED',
  'COMMANDER_PRIVATE != WORLD_KNOWLEDGE',
  'SESSION_LOCAL != WORLD_KNOWLEDGE',
  'STALE != LIVE',
  'DISPUTED CLAIMS ARE PRESERVED',
  'NO ORPHAN CLAIMS',
  'NO AI-SAYS-SO PROVENANCE',
  'ASCENSION AUTONOMY OFF',
  '#23 NOT STARTED',
] as const)
