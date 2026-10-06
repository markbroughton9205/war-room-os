/**
 * Independent verification (pure: no filesystem, network or clock).
 *
 * The independent verifier is given the Commander goal, the acceptance criteria, the resulting code, and direct evidence —
 * never the implementer's own conclusion ("tests passed", "the reviewer says this is fine"). It derives its own acceptance
 * mapping and its own verdict from that evidence, using the same evidence-binding rules foundryReviewEvidence already
 * proved: a claim only reopens work when the disk, the tests, or an explicit criterion actually supports it.
 */
import { decideReviewClaim, type ReviewEvidence } from './foundryReviewEvidence'
import { criterionEvidenced } from './foundrySelfReview'
import type { AcceptanceBasis } from './foundryAcceptanceBasis'
import { nextFindingId, type AcceptanceCoverageItem, type EvidenceClass, type Phase6Finding, type Phase6Source, type Recommendation } from './foundryPhase6Types'

export type IndependentVerifierInput = {
  missionId: string
  generation: number
  /** The Commander goal and acceptance criteria — given as data, never as "the implementer says this satisfies it". */
  basis: AcceptanceBasis
  sources: readonly Phase6Source[]
  primaryFiles: readonly string[]
  testsGreenNow: boolean
  filesMeetCriteria: boolean | null
  earlierClaims?: readonly string[]
  /** A candidate claim to weigh (e.g. what a reviewer or a prior verifier pass said). Absent when there is nothing to weigh yet. */
  claim?: string
}

export type IndependentVerdict = {
  missionId: string
  generation: number
  acceptanceCoverage: AcceptanceCoverageItem[]
  findings: Phase6Finding[]
  recommendation: Recommendation
  evidenceRefs: string[]
}

/**
 * Classifies one claim against direct evidence, using the same disk/tests/criteria weighing foundryReviewEvidence proved,
 * but reported in Phase 6's four-class currency instead of a REOPEN/RETIRE decision:
 *   - the disk, a failing test, or an explicit unmet criterion supporting the claim -> DIRECTLY_PROVEN (actionable)
 *   - real code the claim is about, but nothing the project tests either way        -> PLAUSIBLE_NEEDS_PROBE (needs a probe)
 *   - the disk or the passing tests contradict it, or it matches no criterion       -> UNSUPPORTED (cannot force rework)
 */
export function classifyIndependentClaim(claim: string, evidence: ReviewEvidence): Phase6Finding {
  const verdict = decideReviewClaim(claim, evidence)
  const affectedFiles = evidence.sources.filter(item => item.role === 'source').map(item => item.file)
  if (verdict.decision === 'REOPEN') {
    const needsProbe = verdict.because.includes('no test covers')
    const confidenceClass: EvidenceClass = needsProbe ? 'PLAUSIBLE_NEEDS_PROBE' : 'DIRECTLY_PROVEN'
    return {
      findingId: nextFindingId('independent'),
      severity: 'BLOCKING',
      claim,
      evidenceRefs: [verdict.because],
      affectedFiles,
      confidenceClass,
      actionability: needsProbe ? 'PROBE' : 'REPAIR',
    }
  }
  return {
    findingId: nextFindingId('independent'),
    severity: 'ADVISORY',
    claim,
    evidenceRefs: [verdict.because],
    affectedFiles,
    confidenceClass: 'UNSUPPORTED',
    actionability: 'NONE',
  }
}

/** The independent verifier's own acceptance mapping: does each criterion have direct evidence, derived the same way self-review derives it (never from the implementer's claim). */
export function independentAcceptanceCoverage(basis: AcceptanceBasis, sources: readonly Phase6Source[], primaryFiles: readonly string[]): AcceptanceCoverageItem[] {
  return basis.criteria.map((criterion, index) => {
    const { evidenced, refs } = criterionEvidenced(criterion, sources, primaryFiles)
    return { criterionId: basis.explicit.find(item => item.sentence === criterion)?.id ?? `criterion-${index}`, criterion, evidenced, evidenceRefs: refs }
  })
}

export function runIndependentVerification(input: IndependentVerifierInput): IndependentVerdict {
  const acceptanceCoverage = independentAcceptanceCoverage(input.basis, input.sources, input.primaryFiles)
  const findings: Phase6Finding[] = []
  for (const item of acceptanceCoverage) {
    if (item.evidenced) continue
    findings.push({
      findingId: nextFindingId('independent-coverage'),
      criterionId: item.criterionId,
      severity: 'BLOCKING',
      claim: `Independent check finds no direct evidence for: ${item.criterion}`,
      evidenceRefs: [],
      affectedFiles: [...input.primaryFiles],
      confidenceClass: 'DIRECTLY_PROVEN',
      actionability: 'REPAIR',
    })
  }
  if (input.claim) {
    const evidence: ReviewEvidence = {
      basis: input.basis,
      earlierClaims: input.earlierClaims ?? [],
      testsGreenNow: input.testsGreenNow,
      filesMeetCriteria: input.filesMeetCriteria,
      sources: input.sources,
    }
    const claimFinding = classifyIndependentClaim(input.claim, evidence)
    findings.push(claimFinding)
  }
  if (input.filesMeetCriteria === false) {
    findings.push({
      findingId: nextFindingId('independent-contract'),
      severity: 'BLOCKING',
      claim: 'Direct inspection shows the current files do not satisfy the acceptance contract.',
      evidenceRefs: ['Current disk acceptance-contract check failed.'],
      affectedFiles: [...input.primaryFiles],
      confidenceClass: 'DIRECTLY_PROVEN',
      actionability: 'REPAIR',
    })
  }
  if (!input.testsGreenNow) {
    findings.push({
      findingId: nextFindingId('independent-tests'),
      severity: 'BLOCKING',
      claim: 'Tests are not green at the current generation.',
      evidenceRefs: [],
      affectedFiles: [...input.primaryFiles],
      confidenceClass: 'DIRECTLY_PROVEN',
      actionability: 'REPAIR',
    })
  }
  const evidenceRefs = [...new Set(acceptanceCoverage.flatMap(item => item.evidenceRefs))]
  // Severity already carries this: a retired/unsupported claim is always recorded ADVISORY, never BLOCKING, so only a real blocking finding escalates here.
  const recommendation: Recommendation = findings.some(item => item.severity === 'BLOCKING') ? 'REPAIR_NEEDED' : 'COMPLETE'
  return { missionId: input.missionId, generation: input.generation, acceptanceCoverage, findings, recommendation, evidenceRefs }
}
