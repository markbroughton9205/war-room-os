/**
 * Verification aggregates evidence. A worker success sentence is not proof.
 * Implementation fidelity reuses Mission 03 plan-to-code inspection.
 */
import { deriveEngineeringPatchIntent, falseConfidencePhrase, inspectPlanAgainstSource } from '../foundryReasoningFidelity'
import type { FoundryEvidence, FoundryVerifiedClaim, FrkClaimStatus } from './types'
import { clipText } from './text'

export function bindClaim(input: {
  claimId: string
  claim: string
  supporting: FoundryEvidence[]
  contradicting: FoundryEvidence[]
  workerDeclaredSuccess: boolean
}): FoundryVerifiedClaim {
  const toolSupport = input.supporting.filter(item => item.authority === 'TOOL_RUNTIME')
  const toolConflict = input.contradicting.filter(item => item.authority === 'TOOL_RUNTIME' || item.authority === 'MISSION')
  let status: FrkClaimStatus = 'UNRESOLVED'
  if (toolConflict.length) status = 'REFUTED'
  else if (toolSupport.length && !input.contradicting.length) status = 'PROVEN'
  else if (input.supporting.length && !input.workerDeclaredSuccess) status = 'SUPPORTED'
  else status = 'UNRESOLVED'
  if (input.workerDeclaredSuccess && !toolSupport.length) status = toolConflict.length ? 'REFUTED' : 'UNRESOLVED'
  return {
    claimId: input.claimId,
    claim: clipText(input.claim),
    supportingEvidenceIds: input.supporting.map(item => item.evidenceId),
    contradictingEvidenceIds: input.contradicting.map(item => item.evidenceId),
    status,
    workerDeclaredSuccess: input.workerDeclaredSuccess,
  }
}

export function workerSelfDeclaredSuccess(text: string): boolean {
  return falseConfidencePhrase(text) || /\b(done|fixed|works|complete)\b/i.test(text)
}

export function inspectImplementationFidelity(input: {
  symptom: string
  constraints: string[]
  approach: string
  files: Record<string, string>
  rootCause?: string
}): {
  status: string
  fidelity: string
  mismatch: string
  reinspected: true
  planCorrectCodeWrong: boolean
} {
  const intent = deriveEngineeringPatchIntent({
    symptom: input.symptom,
    constraints: input.constraints,
    approach: input.approach,
    rootCause: input.rootCause,
  })
  const check = inspectPlanAgainstSource({ intent, files: input.files, approach: input.approach })
  return {
    status: check.status,
    fidelity: check.fidelity,
    mismatch: check.mismatch,
    reinspected: true,
    planCorrectCodeWrong: check.planCorrectCodeWrong,
  }
}
