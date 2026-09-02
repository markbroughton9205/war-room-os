// AGI Wave 2 — World Learning logical contracts. "The spine is the store, not the weights":
// these tables are external knowledge/memory, never model weights. Kept distinct from
// lib/memory-records (Commander/operational memory) per Phase 28 — general research findings
// never silently become Commander memory, and vice versa.

export type SourceType =
  | 'web' | 'api' | 'pdf' | 'document' | 'dataset' | 'audio' | 'video' | 'image' | 'sensor'
  | 'database' | 'commander_artifact'

export type SourceStatus = 'active' | 'stale' | 'retracted' | 'superseded'

export type SourceRecord = {
  id: string
  canonical_uri: string | null
  source_type: SourceType
  title: string | null
  publisher: string | null
  language: string | null
  media_type: string
  discovered_at: string
  first_acquired_at: string | null
  last_checked_at: string | null
  access_method: string | null
  content_hash: string | null
  provenance: Record<string, unknown>
  quality_metadata: Record<string, unknown>
  rights_metadata: Record<string, unknown>
  terra_observation_ref: Record<string, unknown>
  status: SourceStatus
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type SourceVersionChangeType = 'initial' | 'updated' | 'unchanged' | 'retracted'

export type SourceVersion = {
  id: string
  source_id: string
  observed_at: string
  content_hash: string
  previous_version_id: string | null
  change_type: SourceVersionChangeType
  content_snippet: string | null
  parser_version: string | null
  extraction_version: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type EntityRelationEdge = { relationType: string; targetEntityId: string; note?: string }

export type EntityRecord = {
  id: string
  label: string
  description: string | null
  entity_type: string
  aliases: string[]
  relations: EntityRelationEdge[]
  project_id: string | null
  source_ref: Record<string, unknown>
  status: 'active' | 'merged' | 'retracted'
  created_at: string
  updated_at: string
}

export type ClaimEvidenceRelation = 'supports' | 'contradicts' | 'qualifies' | 'mentions'
export type ClaimEvidenceRef = { sourceVersionId: string; relation: ClaimEvidenceRelation; note?: string }

/** Shared verification-state vocabulary (Phase 23) — a claim's status is never "verified" merely
 * because one model generated it; only a verifier step (see world-learning's generator/
 * verifier/evaluator separation) may move a claim past 'candidate'. */
export type VerificationState =
  | 'observed' | 'candidate' | 'supported' | 'contested' | 'verified' | 'superseded' | 'retracted'

export type ClaimRecord = {
  id: string
  normalized_claim_text: string
  subject_entity_id: string | null
  predicate: string | null
  object_value: string | null
  claim_type: string
  confidence: number
  valid_from: string | null
  valid_until: string | null
  observed_at: string
  status: VerificationState
  superseded_by: string | null
  evidence_refs: ClaimEvidenceRef[]
  extraction_metadata: Record<string, unknown>
  project_id: string | null
  created_at: string
  updated_at: string
}

export type ContradictionRelationship = 'agrees' | 'contradicts' | 'qualifies' | 'temporally_supersedes' | 'unresolved'

export type ContradictionRecord = {
  id: string
  claim_a_id: string
  claim_b_id: string
  relationship: ContradictionRelationship
  evidence: unknown[]
  confidence: number
  detector: string
  verification_status: 'unverified' | 'reviewed' | 'resolved'
  created_at: string
  resolved_at: string | null
  resolution_refs: Record<string, unknown>
}

export type KnowledgeGapType =
  | 'missing_answer' | 'conflicting_sources' | 'stale_knowledge' | 'insufficient_evidence'
  | 'unknown_relationship' | 'prediction_awaiting_verification' | 'commander_question_unresolved'
  | 'capability_gap'

export type KnowledgeGap = {
  id: string
  project_id: string | null
  conversation_id: string | null
  question: string
  gap_type: KnowledgeGapType
  priority: number
  status: 'open' | 'researching' | 'resolved' | 'dropped'
  source_refs: unknown[]
  created_by: string
  created_at: string
  updated_at: string
  resolved_at: string | null
  resolution_refs: Record<string, unknown>
}

/** Generator / Verifier / Evaluator separation (Phase 24) tagged directly on each observable
 * session item — never hidden chain-of-thought, only the action taken and its result. */
export type LearningSessionItemRole = 'generator' | 'verifier' | 'evaluator'
export type LearningSessionItemType =
  | 'DISCOVERY' | 'ACQUISITION' | 'PARSE' | 'CLAIM_EXTRACTION' | 'VERIFY'
  | 'CONTRADICTION_CHECK' | 'KNOWLEDGE_UPDATE' | 'GAP_CREATION' | 'GAP_RESOLUTION'

export type LearningSessionItem = {
  itemType: LearningSessionItemType
  role: LearningSessionItemRole
  detail: string
  refIds: string[]
  createdAt: string
}

export type LearningSessionStatus = 'running' | 'completed' | 'failed' | 'partial'

export type LearningSession = {
  id: string
  project_id: string | null
  conversation_id: string | null
  objective: string
  status: LearningSessionStatus
  initiated_by: string
  started_at: string
  completed_at: string | null
  source_ids: string[]
  claim_ids: string[]
  gap_ids: string[]
  experience_ids: string[]
  items: LearningSessionItem[]
  outcome_summary: string | null
  metrics: Record<string, unknown>
  created_at: string
}

export type WorldKnowledgeScope = 'global' | 'project'
export type WorldKnowledgeStatus = 'candidate' | 'active' | 'superseded' | 'retracted' | 'contested'

// AGI Wave 2 (Phase 39/40) — forward-compatibility hooks only. No live Terra or Code Operator
// integration exists yet; these describe the jsonb shape a future integration would populate on
// war_room_source_records.terra_observation_ref / war_room_agi_experience_records.
// terra_observation_ref+code_operator_ref. Terra live state must stay time-scoped — never treat a
// stale observation as timeless knowledge (hence the required timestamp).
export type TerraObservationRef = {
  observedAt: string
  location: { latitude: number; longitude: number } | null
  entityRef: string | null
  layerId: string | null
}

/** References lib/native-builder's NativeIssueRecord.id / NativeRepairRecord.id, and/or
 * lib/mission-runtime's RuntimeMission.id — by id only, never a duplicated payload. */
export type CodeOperatorRef = {
  issueId: string | null
  repairId: string | null
  missionId: string | null
}

export type WorldKnowledgeRecord = {
  id: string
  content: string
  claim_ids: string[]
  source_ids: string[]
  project_id: string | null
  scope: WorldKnowledgeScope
  status: WorldKnowledgeStatus
  confidence: number
  valid_from: string
  valid_until: string | null
  superseded_by: string | null
  created_at: string
  updated_at: string
}
