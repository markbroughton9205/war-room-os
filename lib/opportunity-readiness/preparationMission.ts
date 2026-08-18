import type { PreparationMission, RequirementResult } from './types'

const GAP_CLASSIFICATIONS: readonly RequirementResult['classification'][] = [
  'DOCUMENT_REQUIRED',
  'TRAINING_REQUIRED',
  'CREDENTIAL_REQUIRED',
  'EQUIPMENT_REQUIRED',
  // A non-hard CONFIRMED_NOT_MET is the classification behind QUALIFICATION_GAP —
  // it must get a real remediation item too, or that state points the Commander
  // at an empty checklist. Hard-blocking CONFIRMED_NOT_MET requirements are
  // filtered out by the caller via `excludeRequirementIds` (nothing is
  // "prepared" out of a hard blocker).
  'CONFIRMED_NOT_MET',
]

function stepsFor(result: RequirementResult): string[] {
  switch (result.classification) {
    case 'DOCUMENT_REQUIRED':
      return [`Identify where to obtain: ${result.requirementText}`, 'Gather the document', 'Confirm the document is current/valid']
    case 'TRAINING_REQUIRED':
      return [`Identify a training source for: ${result.requirementText}`, 'Complete the training', 'Record completion evidence']
    case 'CREDENTIAL_REQUIRED':
      return [`Confirm current status of: ${result.requirementText}`, 'If missing, identify the issuing body and requirements', 'Obtain or renew the credential']
    case 'EQUIPMENT_REQUIRED':
      return [`Confirm access to: ${result.requirementText}`, 'If unavailable, identify acquisition or rental options', 'Verify equipment meets the opportunity requirement']
    case 'CONFIRMED_NOT_MET':
      return [`Confirm whether this can realistically change: ${result.requirementText}`, 'Identify what would need to happen to satisfy this requirement', 'Reassess this opportunity once resolved']
    default:
      return [`Resolve: ${result.requirementText}`]
  }
}

function effortFor(classification: RequirementResult['classification']): string {
  switch (classification) {
    case 'DOCUMENT_REQUIRED':
      return 'Low — typically hours to a few days.'
    case 'EQUIPMENT_REQUIRED':
      return 'Variable — depends on cost and availability.'
    case 'TRAINING_REQUIRED':
      return 'Medium to high — depends on training length.'
    case 'CREDENTIAL_REQUIRED':
      return 'Medium to high — depends on issuing process and prerequisites.'
    case 'CONFIRMED_NOT_MET':
      return 'Variable — depends on what is required to resolve this gap.'
    default:
      return 'Unknown.'
  }
}

/** Generates a Preparation Mission for every solvable gap on one opportunity.
 * Missions never claim completion — `completionEvidence` describes what would
 * need to be true, not that it is already true. `excludeRequirementIds` keeps
 * hard-blocking requirements from getting a mission that would imply they are
 * a preparable gap rather than a hard eligibility blocker. */
export function buildPreparationMissions(
  requirementResults: RequirementResult[],
  opportunityId: string,
  excludeRequirementIds: ReadonlySet<string> = new Set(),
): PreparationMission[] {
  return requirementResults
    .filter(result => GAP_CLASSIFICATIONS.includes(result.classification) && !excludeRequirementIds.has(result.requirementId))
    .map(result => ({
      id: `pm-${result.requirementId}`,
      title: `Resolve: ${result.requirementText}`,
      reason: `This opportunity requires it and it is currently classified as ${result.classification}.`,
      gapAddressed: result.requirementText,
      expectedResult: `Requirement "${result.requirementText}" becomes CONFIRMED_MET.`,
      requiredSteps: stepsFor(result),
      estimatedEffort: effortFor(result.classification),
      dependency: null,
      completionEvidence: 'Not yet completed. Evidence (document, certificate, or Commander confirmation) required before this mission can be marked done.',
      opportunityIdsUnlocked: [opportunityId],
    }))
}
