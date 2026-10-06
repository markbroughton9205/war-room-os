import type { ClaimStatus, EbcClaim, EbcConflict, EbcEvidence, EbcMissionClass, LumenVerdict } from '@/lib/council/evidence-board/types'
import type { EngineReceipt } from '../types'

export type SupportType = 'DIRECT' | 'CORROBORATING' | 'CONTEXTUAL' | 'CONTRADICTING' | 'INSUFFICIENT'
export type SupportStrength = 'strong' | 'moderate' | 'weak' | 'none'
export type BindingVerificationState = 'VERIFIED' | 'SUPPORTED' | 'UNVERIFIED' | 'CONTRADICTED' | 'STALE' | 'UNKNOWN'

export type ClaimEvidenceBinding = {
  claim_id: string
  claim_text: string
  evidence_refs: string[]
  source_refs: string[]
  support_type: SupportType
  support_strength: SupportStrength
  freshness_state: 'IN_WINDOW' | 'OUT_OF_WINDOW' | 'DATE_UNKNOWN' | 'NOT_REQUIRED'
  verification_state: BindingVerificationState
  contradiction_refs: string[]
}

export type EvidenceConflict = {
  conflict_id: string
  claim_ids: string[]
  evidence_a: string | null
  evidence_b: string | null
  conflict_type: 'DIRECT' | 'TEMPORAL' | 'AUTHORITY' | 'SINGLE_SOURCE_OVERCLAIM' | 'SOURCELESS_VERIFICATION'
  severity: 'low' | 'moderate' | 'high'
  resolution_state: 'open' | 'resolved'
  needed_evidence: string
  reason: string
}

export type ClaimEvidenceGraph = {
  claims: Array<{ claim_id: string; text: string; status: ClaimStatus; derived_from: string[] }>
  evidence: Array<{ evidence_id: string; source: string | null; usable: boolean }>
  support_edges: Array<{ from: string; to: string; support_type: SupportType }>
  contradiction_edges: Array<{ from: string; to: string; conflict_id: string }>
  conflicts: EvidenceConflict[]
  ebc_canonical: true
}

export type EvidenceBindingInput = {
  mission_id: string
  mission_class: EbcMissionClass
  claims: readonly EbcClaim[]
  evidence: readonly EbcEvidence[]
  conflicts?: readonly EbcConflict[]
  lumen_verdicts?: ReadonlyArray<{ claim_id: string; verdict: LumenVerdict; evidence_refs?: string[] }>
}

export type EvidenceBindingResult = {
  bindings: ClaimEvidenceBinding[]
  graph: ClaimEvidenceGraph
  conflicts: EvidenceConflict[]
  receipt: EngineReceipt
}
