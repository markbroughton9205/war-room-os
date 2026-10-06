import type { EngineReceipt } from '../types'

export type FailureCategory =
  | 'DISCOVERY_FAILURE'
  | 'RETRIEVAL_FAILURE'
  | 'EXTRACTION_FAILURE'
  | 'RELEVANCE_REJECTION'
  | 'FRESHNESS_FAILURE'
  | 'AUTHORITY_FAILURE'
  | 'TOOL_UNAVAILABLE'
  | 'TOOL_TIMEOUT'
  | 'AUTH_FAILURE'
  | 'SESSION_IDENTITY_FAILURE'
  | 'STALE_RESULT_DISCARD'
  | 'CONTEXT_FAILURE'
  | 'PLAN_FAILURE'
  | 'BUDGET_EXHAUSTED'
  | 'VERIFICATION_FAILURE'
  | 'SYNTHESIS_FAILURE'
  | 'RENDER_FAILURE'
  | 'PERSISTENCE_FAILURE'
  | 'CHECKPOINT_CORRUPT'
  | 'RESUME_FAILURE'
  | 'STALE_MEMORY_CONTAMINATION'
  | 'TEMPORAL_CONFLICT'
  | 'RESTART_RECOVERY_FAILURE'
  | 'UNKNOWN'

export type DiagnosisConfidence = 'PROVEN' | 'HYPOTHESIS' | 'UNCERTAIN'

export type FailureDiagnosis = {
  symptom: string
  category: FailureCategory
  candidate_cause: string
  supporting_receipts: string[]
  contradicting_receipts: string[]
  confidence_state: DiagnosisConfidence
  next_discriminating_check: string
  eliminated: string[]
  remaining: string[]
  recovery: {
    recommendation: 'retry' | 'alternate_tool' | 'replan' | 'reduce_scope' | 'request_commander' | 'stop_honestly' | 'repair_required'
    grants_authority: false
  }
  persist_as_proven: boolean
}

export type FailureDiagnosisInput = {
  mission_id: string
  task_id?: string
  symptom: string
  receipts?: Array<{ receipt_id: string; capability: string; success: boolean; error?: string | null; result_summary?: string }>
  tool_health?: string
  ebc_state?: string
  completion_state?: string
  session_identity?: { sidebar?: string | null; pane?: string | null }
  stream_events?: string[]
  retry_history?: string[]
  timeout?: boolean
  exception?: string | null
}

export type FailureDiagnosisResult = {
  diagnosis: FailureDiagnosis
  receipt: EngineReceipt
}
