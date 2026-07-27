/**
 * Deterministic, evidence-based dataset-admission policy. Pure functions only — no I/O, no model
 * calls. This is a RIGHTS/ACCESS filter, never a subject-matter filter: nothing here evaluates
 * what a document is *about*, only how it was obtained and what rights attach to it.
 */
import type {
  AcquisitionPolicyDecision,
  DatasetAccessStatus,
  DatasetLicenseRecord,
} from './types'
import { NEVER_AUTO_TRAINING_ACCESS_STATUSES } from './types'

export type SourceAdmissionInput = {
  accessStatus: DatasetAccessStatus
  license: DatasetLicenseRecord
  /** True when the acquisition method itself is known-illegitimate regardless of license. */
  knownIllegitimateAcquisition?: boolean
  illegitimateAcquisitionReason?: string
  authorshipDocumented: boolean
  sourceDocumented: boolean
}

function alwaysAutoAdmit(input: SourceAdmissionInput): boolean {
  if (input.accessStatus === 'public_domain') return true
  if (input.accessStatus === 'commander_owned' && input.sourceDocumented) return true
  if (input.accessStatus === 'commander_licensed' && input.license.recordedBy === 'commander_declared' && input.license.permitsTrainingUse === true) return true
  if (input.accessStatus === 'open_license' && input.license.permitsTrainingUse === true) return true
  if (input.accessStatus === 'public' && input.license.permitsTrainingUse === true && input.sourceDocumented) return true
  return false
}

function requiresReview(input: SourceAdmissionInput): string[] {
  const reasons: string[] = []
  if (input.license.permitsTrainingUse === null) reasons.push('License permits-training-use status is unclear.')
  if (!input.authorshipDocumented) reasons.push('Authorship is not documented.')
  if (!input.sourceDocumented) reasons.push('Source cannot be fully documented.')
  if (input.license.recordedBy === 'unknown') reasons.push('License was not recorded by any authoritative party.')
  if (input.accessStatus === 'public' && input.license.permitsTrainingUse !== true) reasons.push('Publicly visible but training-use permission is not established (possible research-only or mixed-license terms).')
  return reasons
}

export function evaluateSourceAdmission(input: SourceAdmissionInput): AcquisitionPolicyDecision {
  const evaluatedAt = new Date().toISOString()

  if (input.knownIllegitimateAcquisition) {
    return {
      decision: 'auto_reject',
      reasons: [input.illegitimateAcquisitionReason ?? 'Acquisition method is known-illegitimate (stolen data, credential dump, bypassed authentication/paywall, unauthorized private records, or classified material).'],
      isRightsOrAccessBased: true,
      evaluatedAt,
    }
  }

  if (!input.sourceDocumented) {
    return {
      decision: 'auto_reject',
      reasons: ['Source cannot be documented — undocumented provenance is rejected outright, not merely flagged for review.'],
      isRightsOrAccessBased: true,
      evaluatedAt,
    }
  }

  if (NEVER_AUTO_TRAINING_ACCESS_STATUSES.includes(input.accessStatus)) {
    return {
      decision: input.accessStatus === 'unknown' ? 'commander_review_required' : 'auto_reject',
      reasons: [`accessStatus "${input.accessStatus}" may never automatically enter a training dataset.`],
      isRightsOrAccessBased: true,
      evaluatedAt,
    }
  }

  if (alwaysAutoAdmit(input)) {
    return { decision: 'auto_admit', reasons: ['Meets an automatic-admission rule (public domain, documented Commander-owned, or clearly compatible open/licensed terms).'], isRightsOrAccessBased: true, evaluatedAt }
  }

  const reviewReasons = requiresReview(input)
  if (reviewReasons.length) {
    return { decision: 'commander_review_required', reasons: reviewReasons, isRightsOrAccessBased: true, evaluatedAt }
  }

  // Fell through every explicit rule without a positive match — do not guess admit.
  return {
    decision: 'commander_review_required',
    reasons: ['No automatic-admission rule matched and no specific concern was flagged — defaulting to Commander review rather than guessing.'],
    isRightsOrAccessBased: true,
    evaluatedAt,
  }
}
