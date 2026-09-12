/**
 * #22 Phase 8 — Bounded corpus curation scope.
 */
import { DATA_CORPUS_ALLOWED_OPERATIONS } from './profile'

export const DATA_CORPUS_DEFAULT_BOUNDS = Object.freeze({
  max_documents: 40,
  max_chunks: 200,
  max_bytes: 2_000_000,
  max_duplicate_groups: 20,
  max_annotations: 40,
  max_writes: 10,
  max_runtime_ms: 60_000,
  max_retries: 0,
} as const)

export type DataCorpusScope = {
  corpus_question: string
  owner_user_id: string
  requested_by: string
  conversation_id: string | null
  mission_id: string | null
  dataset_scope: string
  source_scope: string[] | null
  document_ids: string[] | null
  allowed_operations: string[]
  max_documents: number
  max_chunks: number
  max_bytes: number
  max_duplicate_groups: number
  max_annotations: number
  max_writes: number
  max_runtime_ms: number
  allow_metadata_write: boolean
  allow_index_support_write: boolean
  created_at: string
  expires_at: string | null
}

export function createDataCorpusScope(input: {
  corpusQuestion: string
  ownerUserId: string
  requestedBy: string
  datasetScope: string
  conversationId?: string | null
  missionId?: string | null
  sourceScope?: string[] | null
  documentIds?: string[] | null
  allowedOperations?: string[]
  allowMetadataWrite?: boolean
  allowIndexSupportWrite?: boolean
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof DATA_CORPUS_DEFAULT_BOUNDS>
}): DataCorpusScope {
  const bounds = { ...DATA_CORPUS_DEFAULT_BOUNDS, ...input.bounds }
  const ops = input.allowedOperations?.length
    ? input.allowedOperations.filter(c => (DATA_CORPUS_ALLOWED_OPERATIONS as readonly string[]).includes(c))
    : [...DATA_CORPUS_ALLOWED_OPERATIONS]

  return {
    corpus_question: input.corpusQuestion.trim(),
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    conversation_id: input.conversationId ?? null,
    mission_id: input.missionId ?? null,
    dataset_scope: input.datasetScope.trim() || 'fixture_bounded',
    source_scope: input.sourceScope ? [...input.sourceScope] : null,
    document_ids: input.documentIds ? [...input.documentIds] : null,
    allowed_operations: ops,
    max_documents: bounds.max_documents,
    max_chunks: bounds.max_chunks,
    max_bytes: bounds.max_bytes,
    max_duplicate_groups: bounds.max_duplicate_groups,
    max_annotations: bounds.max_annotations,
    max_writes: bounds.max_writes,
    max_runtime_ms: bounds.max_runtime_ms,
    allow_metadata_write: input.allowMetadataWrite === true,
    allow_index_support_write: input.allowIndexSupportWrite === true,
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
  }
}

export function isDataCorpusScopeExpired(scope: DataCorpusScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
