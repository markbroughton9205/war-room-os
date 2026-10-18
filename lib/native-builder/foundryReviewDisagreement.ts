/**
 * Disagreement resolution (pure: no filesystem, network or clock).
 *
 * Self-review and the independent verifier sometimes reach different verdicts. Foundry never resolves that by which side
 * has more authority (a bigger model, a later role) — it resolves it by which side's findings have stronger evidence, and
 * when neither side has proof either way, it asks for a bounded probe rather than guessing. No endless reviewer loop: a
 * disagreement can only be OPENED, sent to PROBE, or RESOLVED — never reopened without new evidence.
 */
import type { EvidenceClass, Phase6Finding, Recommendation } from './foundryPhase6Types'

export type DisagreementStatus = 'DISAGREEMENT_OPENED' | 'DISAGREEMENT_PROBE' | 'DISAGREEMENT_RESOLVED'

export type DisagreementRecord = {
  disagreementId: string
  selfReviewRecommendation: Recommendation
  independentRecommendation: Recommendation
  status: DisagreementStatus
  resolution?: Recommendation
  strongestSelfReviewFinding?: Phase6Finding
  strongestIndependentFinding?: Phase6Finding
  reason: string
}

const RANK: Record<EvidenceClass, number> = { DIRECTLY_PROVEN: 3, STRONGLY_SUPPORTED: 2, PLAUSIBLE_NEEDS_PROBE: 1, UNSUPPORTED: 0 }

function strongestBlocking(findings: readonly Phase6Finding[]): Phase6Finding | undefined {
  const blocking = findings.filter(item => item.severity === 'BLOCKING')
  if (!blocking.length) return undefined
  return [...blocking].sort((a, b) => RANK[b.confidenceClass] - RANK[a.confidenceClass])[0]
}

let counter = 0

/**
 * Returns null when both sides already agree — there is nothing to resolve. Otherwise resolves by evidence: whichever
 * side (or neither) has the stronger BLOCKING finding decides REPAIR_NEEDED vs COMPLETE. When the strongest finding on
 * either side is only PLAUSIBLE_NEEDS_PROBE, and there is no DIRECTLY_PROVEN/STRONGLY_SUPPORTED finding to settle it,
 * the disagreement is left at DISAGREEMENT_PROBE for the runtime to run a bounded probe and call this again with the result.
 */
export function resolveDisagreement(input: {
  selfReviewRecommendation: Recommendation
  selfReviewFindings: readonly Phase6Finding[]
  independentRecommendation: Recommendation
  independentFindings: readonly Phase6Finding[]
}): DisagreementRecord | null {
  if (input.selfReviewRecommendation === input.independentRecommendation) return null
  counter += 1
  const selfStrongest = strongestBlocking(input.selfReviewFindings)
  const independentStrongest = strongestBlocking(input.independentFindings)
  const best = [selfStrongest, independentStrongest].filter((item): item is Phase6Finding => Boolean(item))
    .sort((a, b) => RANK[b.confidenceClass] - RANK[a.confidenceClass])[0]
  const base = {
    disagreementId: `disagreement-${counter}`,
    selfReviewRecommendation: input.selfReviewRecommendation,
    independentRecommendation: input.independentRecommendation,
    strongestSelfReviewFinding: selfStrongest,
    strongestIndependentFinding: independentStrongest,
  }
  if (!best) {
    // Neither side has a blocking finding at all, yet the recommendations differ (a defensive case): nothing forces repair.
    return { ...base, status: 'DISAGREEMENT_RESOLVED', resolution: 'COMPLETE', reason: 'Neither side has a blocking finding; nothing to repair.' }
  }
  if (RANK[best.confidenceClass] >= RANK.STRONGLY_SUPPORTED) {
    return { ...base, status: 'DISAGREEMENT_RESOLVED', resolution: 'REPAIR_NEEDED', reason: `${best.confidenceClass}: ${best.claim}` }
  }
  if (best.confidenceClass === 'PLAUSIBLE_NEEDS_PROBE') {
    return { ...base, status: 'DISAGREEMENT_PROBE', reason: `Only plausible-needs-probe evidence exists: ${best.claim}` }
  }
  return { ...base, status: 'DISAGREEMENT_RESOLVED', resolution: 'COMPLETE', reason: 'Strongest finding on either side is unsupported.' }
}

/** After a probe runs, folds its result back into an open disagreement to reach a final resolution — never a third open-ended round. */
export function resolveDisagreementAfterProbe(record: DisagreementRecord, probeFinding: Phase6Finding | null): DisagreementRecord {
  if (record.status !== 'DISAGREEMENT_PROBE') return record
  if (probeFinding && RANK[probeFinding.confidenceClass] >= RANK.STRONGLY_SUPPORTED && probeFinding.severity === 'BLOCKING') {
    return { ...record, status: 'DISAGREEMENT_RESOLVED', resolution: 'REPAIR_NEEDED', reason: `Probe result: ${probeFinding.claim}` }
  }
  return { ...record, status: 'DISAGREEMENT_RESOLVED', resolution: 'COMPLETE', reason: 'Probe found no direct evidence against completion.' }
}
