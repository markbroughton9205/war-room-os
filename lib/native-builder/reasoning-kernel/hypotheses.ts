/**
 * Competing hypotheses. Status changes only when evidence is linked.
 * Confidence is a class, never a fabricated probability.
 */
import type { FoundryEvidence, FoundryEvidenceRequest, FoundryHypothesis, FrkUncertainty } from './types'
import { clipText } from './text'

export function createHypothesis(input: {
  hypothesisId: string
  claim: string
  predictedEvidence?: string[]
  confidenceClass?: FrkUncertainty
}): FoundryHypothesis {
  return {
    hypothesisId: input.hypothesisId,
    claim: clipText(input.claim),
    predictedEvidence: (input.predictedEvidence ?? []).map(clipText),
    supportingEvidence: [],
    contradictingEvidence: [],
    status: 'ACTIVE',
    confidenceClass: input.confidenceClass ?? 'POSSIBLE',
    nextDiscriminatingCheck: null,
  }
}

export function discriminatingQuestion(hypotheses: FoundryHypothesis[]): string {
  const claims = hypotheses.filter(item => item.status === 'ACTIVE' || item.status === 'WEAKENED').map(item => item.claim)
  if (claims.length < 2) return 'What observation would confirm or reject the active explanation?'
  return 'What observation would distinguish these explanations?'
}

export function buildEvidenceRequest(input: {
  requestId: string
  hypotheses: FoundryHypothesis[]
  distinguishingObservation: string
}): FoundryEvidenceRequest {
  const active = input.hypotheses.filter(item => item.status !== 'REJECTED')
  return {
    requestId: input.requestId,
    hypothesisIds: active.map(item => item.hypothesisId),
    question: discriminatingQuestion(active),
    distinguishingObservation: clipText(input.distinguishingObservation),
  }
}

export function updateBeliefs(hypotheses: FoundryHypothesis[], evidence: FoundryEvidence[]): FoundryHypothesis[] {
  for (const item of evidence) {
    for (const hypothesis of hypotheses) {
      if (item.supportsHypothesisIds.includes(hypothesis.hypothesisId) && !hypothesis.supportingEvidence.includes(item.evidenceId)) {
        hypothesis.supportingEvidence.push(item.evidenceId)
      }
      if (item.contradictsHypothesisIds.includes(hypothesis.hypothesisId) && !hypothesis.contradictingEvidence.includes(item.evidenceId)) {
        hypothesis.contradictingEvidence.push(item.evidenceId)
      }
    }
  }
  for (const hypothesis of hypotheses) {
    const supported = hypothesis.supportingEvidence.length > 0
    const contradicted = hypothesis.contradictingEvidence.length > 0
    if (contradicted && !supported) {
      hypothesis.status = 'REJECTED'
      hypothesis.confidenceClass = 'CONTRADICTED'
    } else if (contradicted && supported) {
      hypothesis.status = 'WEAKENED'
      hypothesis.confidenceClass = 'POSSIBLE'
    } else if (supported) {
      hypothesis.status = 'SUPPORTED'
      hypothesis.confidenceClass = 'LIKELY'
    } else {
      hypothesis.status = hypothesis.status === 'REJECTED' ? 'REJECTED' : 'ACTIVE'
    }
  }
  return hypotheses
}

export function selectedHypothesis(hypotheses: FoundryHypothesis[]): FoundryHypothesis | null {
  const supported = hypotheses.filter(item => item.status === 'SUPPORTED')
  if (supported.length === 1) return supported[0]
  return null
}
