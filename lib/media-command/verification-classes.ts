/**
 * HVS verification matrix. Does not replace the existing QC jobs, tool-kernel QC, director QC, or digital-human QC.
 * No single creativePass flag.
 */
export const HVS_VERIFICATION_CLASSES = [
  'PROJECT_INTEGRITY',
  'MEDIA_AVAILABLE',
  'TIMELINE_VALID',
  'EDIT_CORRECT',
  'AUDIO_VALID',
  'TYPOGRAPHY_VALID',
  'FRAMING_VALID',
  'RESOLUTION_VALID',
  'RENDER_VALID',
  'COLOR_TREATMENT',
  'ANIMATION_VALID',
  'RIGHTS_VALID',
  'PROVENANCE_VALID',
  'DETERMINISTIC_QC',
  'CREATIVE_INTENT_MATCH',
] as const
export type HvsVerificationClass = (typeof HVS_VERIFICATION_CLASSES)[number]

export const HVS_VERIFICATION_VERDICTS = ['PASS', 'FAIL', 'NEEDS_HUMAN', 'NOT_RUN', 'NOT_APPLICABLE'] as const
export type HvsVerificationVerdict = (typeof HVS_VERIFICATION_VERDICTS)[number]

export const HVS_BLOCKING_VERIFICATION = [
  'PROJECT_INTEGRITY',
  'MEDIA_AVAILABLE',
  'TIMELINE_VALID',
  'RENDER_VALID',
  'RIGHTS_VALID',
  'PROVENANCE_VALID',
  'DETERMINISTIC_QC',
] as const

export const HVS_CREATIVE_VERIFICATION = [
  'EDIT_CORRECT',
  'AUDIO_VALID',
  'TYPOGRAPHY_VALID',
  'FRAMING_VALID',
  'COLOR_TREATMENT',
  'ANIMATION_VALID',
  'CREATIVE_INTENT_MATCH',
] as const

export type HvsVerificationFacts = {
  projectIntact?: boolean
  mediaAvailable?: boolean | null
  timelineValid?: boolean | null
  renderValid?: boolean | null
  rightsState?: 'OWNABLE' | 'UNKNOWN' | 'BLOCKED' | null
  provenanceValid?: boolean | null
  deterministicQc?: 'PASS' | 'FAIL' | 'NEEDS_HUMAN' | 'NOT_RUN'
  durationMatches?: boolean | null
  aspectMatches?: boolean | null
  resolutionMatches?: boolean | null
  captionsPresent?: boolean | null
  captionsRequired?: boolean | null
  themeUsed?: boolean | null
  themeRequired?: boolean | null
  requiredAssetsPresent?: boolean | null
  beatsPresent?: boolean | null
  beatsRequired?: boolean | null
  audioPresent?: boolean | null
  audioRequired?: boolean | null
  renderExists?: boolean | null
  renderRequired?: boolean | null
}

export type HvsQcEvidenceRef = {
  qcJobId?: string | null
  reportId?: string | null
  receiptId?: string | null
  renderHash?: string | null
  renderJobId?: string | null
  versionId?: string | null
  timestamp?: string | null
  path?: string | null
}

export type HvsVerificationReport = {
  id: string
  classes: Record<HvsVerificationClass, HvsVerificationVerdict>
  blocksDelivery: boolean
  blockingFailures: HvsVerificationClass[]
  kernelQcReferenced: true
  creativePass: undefined
  qcEvidence?: HvsQcEvidenceRef | null
}

function factualIntent(facts: HvsVerificationFacts): HvsVerificationVerdict {
  const checks: Array<boolean | null | undefined> = [
    facts.durationMatches,
    facts.aspectMatches,
    facts.resolutionMatches,
    facts.captionsRequired ? facts.captionsPresent : null,
    facts.themeRequired ? facts.themeUsed : null,
    facts.requiredAssetsPresent,
    facts.beatsRequired ? facts.beatsPresent : null,
    facts.audioRequired ? facts.audioPresent : null,
    facts.renderRequired ? facts.renderExists : null,
  ].filter(value => value !== null && value !== undefined)
  if (!checks.length) return 'NOT_RUN'
  if (checks.some(value => value === false)) return 'FAIL'
  if (checks.every(value => value === true)) return 'PASS'
  return 'NEEDS_HUMAN'
}

export function evaluateVerification(
  facts: HvsVerificationFacts,
  reportId = 'verification-1',
  qcEvidence?: HvsQcEvidenceRef | null,
): HvsVerificationReport {
  const rights = facts.rightsState === 'OWNABLE'
    ? 'PASS'
    : facts.rightsState === 'UNKNOWN' || facts.rightsState === 'BLOCKED'
      ? 'FAIL'
      : 'NOT_RUN'
  const classes: Record<HvsVerificationClass, HvsVerificationVerdict> = {
    PROJECT_INTEGRITY: facts.projectIntact === false ? 'FAIL' : facts.projectIntact === true ? 'PASS' : 'NOT_RUN',
    MEDIA_AVAILABLE: facts.mediaAvailable === false ? 'FAIL' : facts.mediaAvailable === true ? 'PASS' : 'NOT_RUN',
    TIMELINE_VALID: facts.timelineValid === false ? 'FAIL' : facts.timelineValid === true ? 'PASS' : 'NOT_RUN',
    EDIT_CORRECT: 'NEEDS_HUMAN',
    AUDIO_VALID: 'NEEDS_HUMAN',
    TYPOGRAPHY_VALID: 'NEEDS_HUMAN',
    FRAMING_VALID: 'NEEDS_HUMAN',
    RESOLUTION_VALID: facts.resolutionMatches === false ? 'FAIL' : facts.resolutionMatches === true ? 'PASS' : 'NOT_RUN',
    RENDER_VALID: facts.renderValid === false ? 'FAIL' : facts.renderValid === true ? 'PASS' : 'NOT_RUN',
    COLOR_TREATMENT: 'NEEDS_HUMAN',
    ANIMATION_VALID: 'NEEDS_HUMAN',
    RIGHTS_VALID: rights,
    PROVENANCE_VALID: facts.provenanceValid === false ? 'FAIL' : facts.provenanceValid === true ? 'PASS' : 'NOT_RUN',
    DETERMINISTIC_QC: facts.deterministicQc ?? 'NOT_RUN',
    CREATIVE_INTENT_MATCH: factualIntent(facts),
  }
  const blockingFailures = HVS_BLOCKING_VERIFICATION.filter(name => classes[name] === 'FAIL')
  return {
    id: reportId,
    classes,
    blocksDelivery: blockingFailures.length > 0,
    blockingFailures,
    kernelQcReferenced: true,
    creativePass: undefined,
    qcEvidence: qcEvidence ?? null,
  }
}
