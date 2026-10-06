/**
 * Phase 6 completion gate (pure: no filesystem, network or clock).
 *
 * Folds self-review, independent verification, and any disagreement resolution into one completion decision and a
 * structured receipt — the thing a Commander can actually read instead of a wall of internal review chatter. Also the
 * loop-bound helpers: the same finding, once retired, does not reopen the mission again without new evidence.
 */
import { reviewClaimKey } from './foundryAcceptanceBasis'
import type { DisagreementRecord } from './foundryReviewDisagreement'
import type { IndependentVerdict } from './foundryIndependentVerifier'
import type { SelfReviewResult } from './foundrySelfReview'
import type { Phase6Finding, Recommendation } from './foundryPhase6Types'

export type Phase6VerificationReceipt = {
  missionId: string
  generation: number
  selfReviewRecommendation: Recommendation
  independentRecommendation: Recommendation
  disagreement: DisagreementRecord | null
  unresolvedBlockingFindings: Phase6Finding[]
  persistence: { required: boolean; survived: boolean } | null
  complete: boolean
  reason: string
}

/** The key a finding is deduped/retired under: the same normalization foundryAcceptanceBasis already uses for reviewer claims. */
export function findingKey(finding: Phase6Finding): string {
  return reviewClaimKey(finding.claim)
}

/** A finding whose key is already in the retired set does not reopen the mission again — the same last-N bound the runtime already keeps for reviewer claims. */
export function activeFindings(findings: readonly Phase6Finding[], retiredKeys: readonly string[]): Phase6Finding[] {
  const retired = new Set(retiredKeys)
  return findings.filter(item => !retired.has(findingKey(item)))
}

/** Findings whose evidence is strong enough, and not already retired, that they must block completion. */
function blockingUnresolved(findings: readonly Phase6Finding[], retiredKeys: readonly string[]): Phase6Finding[] {
  return activeFindings(findings, retiredKeys).filter(item => item.severity === 'BLOCKING' && item.confidenceClass !== 'UNSUPPORTED')
}

export function phase6CompletionAllowed(input: {
  missionId: string
  generation: number
  selfReview: SelfReviewResult
  independentVerdict: IndependentVerdict
  disagreement: DisagreementRecord | null
  retiredFindingKeys?: readonly string[]
  persistence?: { required: boolean; survived: boolean } | null
}): Phase6VerificationReceipt {
  const retired = input.retiredFindingKeys ?? []
  const unresolvedBlockingFindings = [
    ...blockingUnresolved(input.selfReview.findings, retired),
    ...blockingUnresolved(input.independentVerdict.findings, retired),
  ]
  const persistenceOk = !input.persistence?.required || input.persistence.survived
  const disagreementOpen = Boolean(input.disagreement && input.disagreement.status !== 'DISAGREEMENT_RESOLVED')
  const disagreementBlocksCompletion = Boolean(input.disagreement?.status === 'DISAGREEMENT_RESOLVED' && input.disagreement.resolution === 'REPAIR_NEEDED')
  const complete = unresolvedBlockingFindings.length === 0 && persistenceOk && !disagreementOpen && !disagreementBlocksCompletion

  const reason = complete
    ? 'Every required criterion is directly evidenced, self-review and independent verification agree (or the disagreement resolved to complete), and required persistence checks pass.'
    : disagreementOpen
      ? `An unresolved disagreement remains open: ${input.disagreement?.reason}`
      : disagreementBlocksCompletion
        ? `The disagreement resolved to repair: ${input.disagreement?.reason}`
        : !persistenceOk
          ? 'The result does not survive a restart, and persistence is required.'
          : `${unresolvedBlockingFindings.length} unresolved finding(s): ${unresolvedBlockingFindings.map(item => item.claim).slice(0, 3).join(' | ')}`

  return {
    missionId: input.missionId,
    generation: input.generation,
    selfReviewRecommendation: input.selfReview.recommendation,
    independentRecommendation: input.independentVerdict.recommendation,
    disagreement: input.disagreement,
    unresolvedBlockingFindings,
    persistence: input.persistence ?? null,
    complete,
    reason,
  }
}
