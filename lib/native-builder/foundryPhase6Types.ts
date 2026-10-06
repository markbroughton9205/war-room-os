/**
 * Shared Phase 6 types (pure: no filesystem, network or clock).
 *
 * Phase 6 adds three things on top of the Phase 5 reviewer/evidence stack: a self-review step that inspects the implementer's
 * own evidence before anyone else looks at it, an independent verifier whose context is built without the implementer's
 * conclusion, and a disagreement-resolution step for when self-review and the independent verifier reach different verdicts.
 * All three speak in the same currency: a Finding classified by how strong its evidence is, never a numeric confidence score.
 */

/** How strong the evidence behind a finding is. Never a number: a class the evidence itself puts the finding in. */
export type EvidenceClass = 'DIRECTLY_PROVEN' | 'STRONGLY_SUPPORTED' | 'PLAUSIBLE_NEEDS_PROBE' | 'UNSUPPORTED'

export type FindingActionability = 'REPAIR' | 'PROBE' | 'NONE'

export type Phase6Finding = {
  findingId: string
  criterionId?: string
  severity: 'BLOCKING' | 'ADVISORY'
  claim: string
  evidenceRefs: string[]
  reproduction?: string
  affectedFiles: string[]
  confidenceClass: EvidenceClass
  actionability: FindingActionability
}

export type AcceptanceCoverageItem = { criterionId: string; criterion: string; evidenced: boolean; evidenceRefs: string[] }

export type Recommendation = 'COMPLETE' | 'REPAIR_NEEDED'

/** A source file as Phase 6 sees it: the same shape foundryReviewEvidence/foundryEditScope already use, so nothing new is invented. */
export type Phase6Source = { file: string; text: string; role: 'source' | 'test' }

let counter = 0
/** Deterministic-enough ids for findings within one process; callers that need cross-run stability pass their own findingId. */
export function nextFindingId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}
