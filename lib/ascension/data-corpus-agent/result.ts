/**
 * #22 Phase 8 — DATA_CORPUS_AGENT result contracts. No hidden CoT.
 */
import type { DataCorpusAgentIdentity } from './identity'
import type { DataCorpusScope } from './scope'

export const CORPUS_QUALITY_STATES = [
  'HIGH_QUALITY',
  'ACCEPTABLE',
  'LOW_QUALITY',
  'MALFORMED',
  'DUPLICATE',
  'NEAR_DUPLICATE',
  'STALE',
  'CONFLICTING',
  'MISSING_PROVENANCE',
  'MISSING_LICENSE_METADATA',
  'INCOMPLETE',
  'UNVERIFIED',
  'OUT_OF_SCOPE',
  'REVIEW_REQUIRED',
] as const
export type CorpusQualityState = (typeof CORPUS_QUALITY_STATES)[number]

export const CORPUS_DEDUPE_STATES = [
  'EXACT_DUPLICATE',
  'NEAR_DUPLICATE',
  'RELATED_NOT_DUPLICATE',
  'UNRESOLVED',
] as const
export type CorpusDedupeState = (typeof CORPUS_DEDUPE_STATES)[number]

export const CORPUS_OWNERSHIP_SCOPES = [
  'PUBLIC_SOURCE',
  'COMMANDER_PRIVATE',
  'USER_PRIVATE',
  'SYSTEM_INTERNAL',
  'LICENSE_RESTRICTED',
  'UNKNOWN_SCOPE',
] as const
export type CorpusOwnershipScope = (typeof CORPUS_OWNERSHIP_SCOPES)[number]

export const RETRIEVAL_SUITABILITY = [
  'RETRIEVAL_READY',
  'RETRIEVAL_LIMITED',
  'NOT_RETRIEVAL_READY',
] as const
export type RetrievalSuitability = (typeof RETRIEVAL_SUITABILITY)[number]

export const WR_CORPUS_SUITABILITY = [
  'WR_CORPUS_CANDIDATE',
  'WR_CORPUS_REVIEW_REQUIRED',
  'WR_CORPUS_EXCLUDE',
  'UNKNOWN',
] as const
export type WrCorpusSuitability = (typeof WR_CORPUS_SUITABILITY)[number]

export const DATA_CORPUS_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DEGRADED',
  'FAILED',
  'DENIED',
] as const
export type DataCorpusStatus = (typeof DATA_CORPUS_STATUSES)[number]

export type CorpusDuplicateGroup = {
  group_id: string
  dedupe_state: CorpusDedupeState
  document_ids: string[]
  content_hash?: string | null
  auto_deleted: false
}

export type CorpusDocumentFinding = {
  document_id: string
  quality: CorpusQualityState[]
  freshness: 'FRESH' | 'DUE' | 'STALE' | 'UNKNOWN' | string
  ownership_scope: CorpusOwnershipScope
  retrieval_suitability: RetrievalSuitability
  wr_corpus_suitability: WrCorpusSuitability
  provenance_present: boolean
  license_metadata_present: boolean
  content_hash: string | null
  notes: string[]
}

export type DataCorpusDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type DataCorpusWriteRecord = {
  kind: 'METADATA_ANNOTATION' | 'INDEX_SUPPORT_ANNOTATION'
  document_id: string
  label: string
  persisted_to_production_corpus: false
}

export type DataCorpusResult = {
  agent_id: string
  agent_role: 'DATA_CORPUS_AGENT'
  status: DataCorpusStatus
  corpus_question: string
  scope: DataCorpusScope
  documents_examined: number
  chunks_examined: number
  quality_summary: string
  duplicate_groups: CorpusDuplicateGroup[]
  provenance_gaps: string[]
  license_gaps: string[]
  stale_records: string[]
  conflicts: string[]
  retrieval_suitability: Array<{ document_id: string; suitability: RetrievalSuitability }>
  wr_corpus_candidates: Array<{ document_id: string; suitability: WrCorpusSuitability; recommendation_only: true }>
  wr_corpus_exclusions: string[]
  review_required: string[]
  writes_performed: DataCorpusWriteRecord[]
  denials: DataCorpusDenial[]
  limitations: string[]
  unavailable_capabilities: string[]
  audit_id: string | null
  started_at: string
  completed_at: string
  owner_scope: string
  mission_id: string | null
  conversation_id: string | null
  identity: DataCorpusAgentIdentity
  boundary_notes: readonly string[]
  plan_summary: string
  document_findings: CorpusDocumentFinding[]
  search_stage4_unchanged: true
  embedding_model_unchanged: true
  chunk_version_unchanged: true
  roadmap_23_status: 'NOT_STARTED'
  crawl_authority: 'DENIED'
  training_authority: 'DENIED'
}

export const DATA_CORPUS_BOUNDARY_NOTES = Object.freeze([
  'DATA_CORPUS_AGENT != WR-CORPUS TRAINER',
  'DATA_CORPUS_AGENT != CRAWLER AUTHORITY',
  'DATA_CORPUS_AGENT != SOURCE APPROVER',
  'CURATION != TRAINING',
  'INDEXING != MODEL LEARNING',
  'DEDUPLICATION FINDING != DELETION AUTHORIZATION',
  'WR_CORPUS_CANDIDATE != #23 STARTED',
  'TERRA LIVE OBSERVATION != TRAINING DATA APPROVED',
  'PRIVATE SESSION DATA != SHARED CORPUS',
  'NO CRAWL AUTHORITY',
  'NO TRAINING AUTHORITY',
  'ASCENSION AUTONOMY OFF',
] as const)
