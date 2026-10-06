import { isExternalResearchMission, isUsableExternalEvidence, lumenMaySupportExternalClaim, usableEvidenceForClaim } from '@/lib/council/evidence-board/researchTruth'
import { canonicalizeSourceKey, independentSourceCount } from '@/lib/council/gi/lumenQuality'
import type { EbcClaim, EbcConflict, EbcEvidence, LumenVerification } from '@/lib/council/evidence-board/types'
import { createEngineReceipt } from '../receipts'
import type {
  BindingVerificationState,
  ClaimEvidenceBinding,
  ClaimEvidenceGraph,
  EvidenceBindingInput,
  EvidenceBindingResult,
  EvidenceConflict,
  SupportStrength,
  SupportType,
} from './types'

function supportTypeFor(claim: EbcClaim, usable: readonly EbcEvidence[], conflicts: readonly EvidenceConflict[]): SupportType {
  if (conflicts.some(row => row.claim_ids.includes(claim.claim_id) && row.resolution_state === 'open')) return 'CONTRADICTING'
  if (!usable.length) return 'INSUFFICIENT'
  const independent = independentSourceCount(usable)
  if (independent >= 2) return 'CORROBORATING'
  if (usable.some(row => row.kind === 'primary_external' || row.source_type === 'primary_external')) return 'DIRECT'
  return 'CONTEXTUAL'
}

function supportStrength(usable: readonly EbcEvidence[]): SupportStrength {
  const independent = independentSourceCount(usable)
  if (independent >= 2 && usable.some(row => row.kind === 'primary_external' || row.source_type === 'primary_external')) return 'strong'
  if (independent >= 1) return 'moderate'
  return usable.length ? 'weak' : 'none'
}

export function evidenceConflictFromEbc(conflict: EbcConflict): EvidenceConflict {
  return {
    conflict_id: conflict.conflict_id,
    claim_ids: [...conflict.claim_ids],
    evidence_a: conflict.contradicting_evidence_ids[0] ?? null,
    evidence_b: conflict.contradicting_evidence_ids[1] ?? null,
    conflict_type: /READY|live probe/i.test(conflict.reason) ? 'SINGLE_SOURCE_OVERCLAIM' : 'DIRECT',
    severity: conflict.open ? 'high' : 'low',
    resolution_state: conflict.open ? 'open' : 'resolved',
    needed_evidence: conflict.required_test,
    reason: conflict.reason,
  }
}

export function recordEvidenceConflict(input: {
  conflict_id: string
  claim_ids: readonly string[]
  evidence_a?: string | null
  evidence_b?: string | null
  reason: string
  needed_evidence: string
  conflict_type?: EvidenceConflict['conflict_type']
}): EvidenceConflict {
  return {
    conflict_id: input.conflict_id,
    claim_ids: [...input.claim_ids],
    evidence_a: input.evidence_a ?? null,
    evidence_b: input.evidence_b ?? null,
    conflict_type: input.conflict_type ?? 'DIRECT',
    severity: 'high',
    resolution_state: 'open',
    needed_evidence: input.needed_evidence,
    reason: input.reason,
  }
}

export function verifiedRequiresEvidenceRefs(input: {
  mission_class: EvidenceBindingInput['mission_class']
  evidence_refs: readonly string[]
  usable_count: number
}): boolean {
  if (!isExternalResearchMission(input.mission_class)) return input.evidence_refs.length > 0
  return input.evidence_refs.length > 0 && input.usable_count > 0
}

export function canPromoteToVerified(input: {
  mission_class: EvidenceBindingInput['mission_class']
  claim: EbcClaim
  evidence: readonly EbcEvidence[]
  lumen_verdict?: LumenVerification['verdict']
  evidence_refs?: readonly string[]
  open_conflicts: boolean
}): boolean {
  if (input.open_conflicts) return false
  if (input.lumen_verdict && input.lumen_verdict !== 'SUPPORTED') return false
  if (isExternalResearchMission(input.mission_class)) {
    const usable = usableEvidenceForClaim(input.claim, input.evidence)
    if (!usable.length) return false
    if (!(input.evidence_refs?.length || usable.length)) return false
    return verifiedRequiresEvidenceRefs({
      mission_class: input.mission_class,
      evidence_refs: input.evidence_refs ?? usable.map(row => row.evidence_id),
      usable_count: usable.length,
    })
  }
  return (input.evidence_refs?.length ?? input.claim.evidence_ids.length) > 0
}

export function canMarkExternallySupported(input: {
  mission_class: EvidenceBindingInput['mission_class']
  claim: EbcClaim
  evidence: readonly EbcEvidence[]
}): boolean {
  if (!isExternalResearchMission(input.mission_class)) return input.claim.evidence_ids.length > 0
  return lumenMaySupportExternalClaim(input.claim, input.evidence)
}

function verificationState(claim: EbcClaim, bindingOk: boolean, conflicts: readonly EvidenceConflict[]): BindingVerificationState {
  if (conflicts.some(row => row.claim_ids.includes(claim.claim_id) && row.resolution_state === 'open')) return 'CONTRADICTED'
  if (claim.status === 'STALE') return 'STALE'
  if (claim.status === 'VERIFIED' && bindingOk) return 'VERIFIED'
  if (claim.status === 'SUPPORTED' && bindingOk) return 'SUPPORTED'
  if (!bindingOk) return 'UNVERIFIED'
  return claim.status === 'VERIFIED' ? 'UNVERIFIED' : 'UNKNOWN'
}

export function bindClaimEvidence(input: EvidenceBindingInput): EvidenceBindingResult {
  const started = Date.now()
  const conflicts = [
    ...(input.conflicts ?? []).map(evidenceConflictFromEbc),
  ]
  const bindings: ClaimEvidenceBinding[] = input.claims.map(claim => {
    const usable = usableEvidenceForClaim(claim, input.evidence)
    const lumen = input.lumen_verdicts?.find(row => row.claim_id === claim.claim_id)
    const supported = canMarkExternallySupported({ mission_class: input.mission_class, claim, evidence: input.evidence })
    if (claim.status === 'VERIFIED' && !canPromoteToVerified({
      mission_class: input.mission_class,
      claim,
      evidence: input.evidence,
      lumen_verdict: lumen?.verdict,
      evidence_refs: lumen?.evidence_refs ?? usable.map(row => row.evidence_id),
      open_conflicts: conflicts.some(row => row.resolution_state === 'open'),
    })) {
      conflicts.push(recordEvidenceConflict({
        conflict_id: `bind-sourceless-${claim.claim_id}`,
        claim_ids: [claim.claim_id],
        reason: 'VERIFIED requires usable evidence refs',
        needed_evidence: 'Bind at least one usable external source before VERIFIED',
        conflict_type: 'SOURCELESS_VERIFICATION',
      }))
    }
    const type = supportTypeFor(claim, usable, conflicts)
    return {
      claim_id: claim.claim_id,
      claim_text: claim.text,
      evidence_refs: usable.map(row => row.evidence_id),
      source_refs: [...new Set(usable.map(row => canonicalizeSourceKey(row.final_url || row.url)).filter(Boolean))],
      support_type: type,
      support_strength: supportStrength(usable),
      freshness_state: isExternalResearchMission(input.mission_class) ? (usable.length ? 'IN_WINDOW' : 'DATE_UNKNOWN') : 'NOT_REQUIRED',
      verification_state: verificationState(claim, supported, conflicts),
      contradiction_refs: conflicts.filter(row => row.claim_ids.includes(claim.claim_id)).map(row => row.conflict_id),
    }
  })

  const graph: ClaimEvidenceGraph = {
    claims: input.claims.map(claim => ({
      claim_id: claim.claim_id,
      text: claim.text,
      status: claim.status,
      derived_from: [],
    })),
    evidence: input.evidence.map(row => ({
      evidence_id: row.evidence_id,
      source: row.final_url || row.url || null,
      usable: isUsableExternalEvidence(row),
    })),
    support_edges: bindings.flatMap(row => row.evidence_refs.map(id => ({
      from: id,
      to: row.claim_id,
      support_type: row.support_type,
    }))),
    contradiction_edges: conflicts.filter(row => row.evidence_a && row.evidence_b).map(row => ({
      from: row.evidence_a as string,
      to: row.evidence_b as string,
      conflict_id: row.conflict_id,
    })),
    conflicts,
    ebc_canonical: true,
  }

  return {
    bindings,
    graph,
    conflicts,
    receipt: createEngineReceipt({
      engine: 'evidence-binding',
      mission_id: input.mission_id,
      input_refs: input.claims.map(row => row.claim_id),
      output_refs: bindings.map(row => row.claim_id),
      started_at: started,
      decision_count: bindings.length,
      failure_state: bindings.every(row => row.support_type === 'INSUFFICIENT') ? 'no_usable_evidence' : conflicts.some(row => row.resolution_state === 'open') ? 'conflict_open' : 'none',
    }),
  }
}
