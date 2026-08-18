import type {
  AssessmentInput,
  CommanderReadinessCard,
  FieldBriefFacts,
  ReadinessState,
  RequirementResult,
} from './types'
import { matchRequirements, isHardBlocking } from './requirementMatcher'
import { analyzeFinancials } from './financialAnalysis'
import { buildCommanderQuestions } from './commanderQuestions'
import { buildProviderQuestions } from './providerQuestions'
import { buildPreparationMissions } from './preparationMission'
import { recordGapObservations } from './developmentGapDetector'

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false
  const parsed = Date.parse(deadline)
  if (Number.isNaN(parsed)) return false
  return parsed < Date.now()
}

/**
 * Derives the readiness state from underlying requirement evidence. Order
 * matters: earlier checks are strictly more severe and short-circuit later,
 * softer ones, so a numeric score can never hide a hard blocker or an
 * unresolved eligibility question.
 *
 * Zero requirements is NOT automatically READY_NOW: unless the caller has
 * explicitly asserted `requirementsResearched: true` (meaning it verified the
 * opportunity truly has no requirements), an empty requirements array is
 * treated as incomplete data — ELIGIBILITY_UNCONFIRMED, not a silent all-clear.
 */
function deriveReadinessState(
  requirementResults: RequirementResult[],
  deadline: string | null,
  commanderDecision: AssessmentInput['commanderDecision'],
  requirementsResearched: boolean,
): ReadinessState {
  if (commanderDecision === 'defer') return 'DEFERRED'

  if (isDeadlinePassed(deadline)) return 'BLOCKED'

  if (requirementResults.length === 0) {
    return requirementsResearched ? 'READY_NOW' : 'ELIGIBILITY_UNCONFIRMED'
  }

  const byClassification = (classification: RequirementResult['classification']) =>
    requirementResults.filter(result => result.classification === classification)

  const confirmedNotMet = byClassification('CONFIRMED_NOT_MET')

  if (byClassification('DOCUMENT_REQUIRED').length > 0) return 'DOCUMENTATION_NEEDED'
  if (byClassification('TRAINING_REQUIRED').length > 0) return 'TRAINING_REQUIRED'
  if (byClassification('LOCATION_REQUIRED').length > 0) return 'LOCATION_CONSTRAINT'
  if (confirmedNotMet.length > 0) return 'QUALIFICATION_GAP'
  if (byClassification('COMMANDER_CONFIRMATION_REQUIRED').length > 0) return 'OPERATOR_INPUT_REQUIRED'
  if (byClassification('UNKNOWN').length > 0) return 'ELIGIBILITY_UNCONFIRMED'
  if (byClassification('CREDENTIAL_REQUIRED').length > 0 || byClassification('EQUIPMENT_REQUIRED').length > 0) return 'READY_WITH_PREP'
  if (byClassification('DEADLINE_CONSTRAINT').length > 0) return 'READY_WITH_PREP'

  return 'READY_NOW'
}

/**
 * Builds the recommendedNextAction text with one explicit branch per
 * readiness state — no state silently falls into a generic "work the
 * checklist" message that may not apply to it (e.g. BLOCKED/DEFERRED, where
 * there is nothing to prepare).
 */
function buildRecommendedNextAction(
  readinessState: ReadinessState,
  hardBlockedRequirementText: string | null,
  hasPreparationPath: boolean,
  requirementsCount: number,
): string {
  if (hardBlockedRequirementText || readinessState === 'NOT_CURRENTLY_ELIGIBLE') {
    return 'Do not pursue until the hard eligibility blocker is resolved or confirmed changeable.'
  }
  switch (readinessState) {
    case 'READY_NOW':
      return 'Proceed — all known requirements are confirmed met. Confirm remaining provider questions before acting.'
    case 'OPERATOR_INPUT_REQUIRED':
      return 'Answer the Commander questions below before further action.'
    case 'ELIGIBILITY_UNCONFIRMED':
      return requirementsCount === 0
        ? 'This opportunity\'s requirements have not yet been researched. Research requirements before assessing readiness.'
        : 'Answer the Commander questions below before further action.'
    case 'QUALIFICATION_GAP':
      return hasPreparationPath
        ? 'Resolve the identified qualification gap before pursuing this opportunity — work the preparation checklist below, then reassess.'
        : 'No automatic preparation path is available for the identified qualification gap. Commander review required.'
    case 'DOCUMENTATION_NEEDED':
    case 'TRAINING_REQUIRED':
    case 'READY_WITH_PREP':
      return 'Work the preparation checklist below, then reassess.'
    case 'LOCATION_CONSTRAINT':
      return 'Confirm the location/travel requirement can realistically be met, then reassess.'
    case 'BLOCKED':
      return 'This opportunity is no longer actionable under its current deadline.'
    case 'DEFERRED':
      return 'This opportunity is deferred. No further preparation is recommended until resumed by the Commander.'
    default:
      return 'Review this opportunity\'s requirements before proceeding.'
  }
}

function buildFieldBrief(card: Pick<CommanderReadinessCard, 'readinessState' | 'location' | 'deadline' | 'requiredDocuments' | 'requiredEquipment' | 'providerQuestions' | 'estimatedEffectiveHourlyValue' | 'estimatedTimeCommitment'>): FieldBriefFacts {
  if (card.readinessState !== 'READY_NOW' && card.readinessState !== 'READY_WITH_PREP') return null
  return {
    whereToGo: card.location,
    when: card.deadline,
    whatToBring: [...card.requiredDocuments, ...card.requiredEquipment],
    whatToExpect: 'Not yet verified — populate from provider confirmation before field execution.',
    whatToAsk: card.providerQuestions.map(question => question.question),
    expectedIncome: card.estimatedEffectiveHourlyValue,
    expectedTime: card.estimatedTimeCommitment,
    successCheckpoint: 'Commander reports outcome with evidence after participation.',
  }
}

export function assessOpportunityReadiness(input: AssessmentInput): CommanderReadinessCard {
  const { opportunity, commanderFacts = {}, commanderDecision = null } = input
  const requirementsResearched = opportunity.requirementsResearched === true

  const requirementResults = matchRequirements(opportunity.requirements, commanderFacts)

  // Hard-block detection: a CONFIRMED_NOT_MET on a hard-blocking requirement
  // overrides everything else, including an explicit "approve" decision or a
  // "defer" decision — see requirementMatcher.ts isHardBlocking, which never
  // lets caller input downgrade an intrinsic hard-block category.
  const hardBlockedRequirement = opportunity.requirements.find((requirement, index) => {
    const result = requirementResults[index]
    return result?.classification === 'CONFIRMED_NOT_MET' && isHardBlocking(requirement)
  })

  const readinessState: ReadinessState = hardBlockedRequirement
    ? 'NOT_CURRENTLY_ELIGIBLE'
    : deriveReadinessState(requirementResults, opportunity.deadline, commanderDecision, requirementsResearched)

  const metCount = requirementResults.filter(result => result.classification === 'CONFIRMED_MET').length
  const totalCount = requirementResults.length
  const readinessScore = totalCount > 0 ? Math.round((metCount / totalCount) * 100) : null

  const financial = analyzeFinancials(opportunity.compensation, opportunity.timeCommitment, opportunity.knownCosts)
  const commanderQuestions = buildCommanderQuestions(requirementResults)
  const providerQuestions = buildProviderQuestions(opportunity)
  const preparationMissions = buildPreparationMissions(
    requirementResults,
    opportunity.id,
    hardBlockedRequirement ? new Set([hardBlockedRequirement.id]) : undefined,
  )

  // Use the sanitized financial.compensation (not the raw opportunity.compensation)
  // so an invalid/UNKNOWN-basis compensation figure can never surface a fabricated
  // number through recurringDevelopmentGaps.compensationRangeObserved — same
  // invariant as card.compensation, just a second consumer of the same raw input.
  recordGapObservations(opportunity.id, requirementResults, financial.compensation.amount, financial.compensation.currency)

  const requiredDocuments = requirementResults.filter(r => r.classification === 'DOCUMENT_REQUIRED').map(r => r.requirementText)
  const requiredCredentials = requirementResults.filter(r => r.classification === 'CREDENTIAL_REQUIRED' && r.category !== 'certification').map(r => r.requirementText)
  const requiredCertifications = requirementResults.filter(r => r.classification === 'CREDENTIAL_REQUIRED' && r.category === 'certification').map(r => r.requirementText)
  const requiredSkills = requirementResults.filter(r => r.category === 'skill').map(r => r.requirementText)
  const trainingGaps = requirementResults.filter(r => r.classification === 'TRAINING_REQUIRED').map(r => r.requirementText)
  const requiredEquipment = requirementResults.filter(r => r.classification === 'EQUIPMENT_REQUIRED').map(r => r.requirementText)
  const travelLocationConstraints = requirementResults.filter(r => r.classification === 'LOCATION_REQUIRED').map(r => r.requirementText)

  const risksBlockers: string[] = []
  if (hardBlockedRequirement) risksBlockers.push(`Hard eligibility blocker: ${hardBlockedRequirement.text}`)
  if (isDeadlinePassed(opportunity.deadline)) risksBlockers.push('Deadline has already passed.')
  if (financial.compensation.basis === 'UNKNOWN' || financial.compensation.amount === null) risksBlockers.push('Compensation is unconfirmed — do not assume this opportunity pays a specific amount.')
  if (requirementResults.length === 0 && !requirementsResearched) risksBlockers.push('Requirements have not yet been researched for this opportunity — readiness cannot be fully assessed.')

  const evidenceSourceReferences = [
    opportunity.sourceUrl ? `source: ${opportunity.sourceUrl}` : null,
    opportunity.source ? `channel: ${opportunity.source}` : null,
    ...requirementResults.map(r => `${r.requirementText}: ${r.evidenceSource}`),
  ].filter((value): value is string => Boolean(value))

  const recommendedNextAction = buildRecommendedNextAction(
    readinessState,
    hardBlockedRequirement?.text ?? null,
    preparationMissions.length > 0,
    requirementResults.length,
  )

  const preparationChecklist = [
    ...preparationMissions.map(mission => mission.title),
    ...(commanderQuestions.length ? ['Answer outstanding Commander questions'] : []),
  ]

  const cardBase: Omit<CommanderReadinessCard, 'fieldBriefFacts'> = {
    opportunityName: opportunity.title,
    providerEmployer: opportunity.provider,
    opportunityType: opportunity.opportunityType,
    source: opportunity.source,
    location: opportunity.location,
    workMode: opportunity.workMode,
    compensation: {
      value: financial.compensation.amount,
      currency: financial.compensation.currency,
      basis: financial.compensation.amount === null ? 'UNKNOWN' : financial.compensation.basis,
      notes: financial.compensation.notes ?? null,
    },
    compensationBasis: financial.compensation.amount === null ? 'UNKNOWN' : financial.compensation.basis,
    estimatedTimeCommitment: financial.estimatedTotalTimeCommitmentHours,
    estimatedEffectiveHourlyValue: financial.effectiveHourlyReturn,
    requiredQualifications: requirementResults.map(r => r.requirementText),
    confirmedMetQualifications: requirementResults.filter(r => r.classification === 'CONFIRMED_MET').map(r => r.requirementText),
    confirmedMissingQualifications: requirementResults.filter(r => r.classification === 'CONFIRMED_NOT_MET').map(r => r.requirementText),
    unknownRequirements: requirementResults.filter(r => r.classification === 'UNKNOWN' || r.classification === 'COMMANDER_CONFIRMATION_REQUIRED').map(r => r.requirementText),
    commanderQuestions,
    requiredDocuments,
    requiredCredentials,
    requiredCertifications,
    requiredSkills,
    trainingGaps,
    requiredEquipment,
    travelLocationConstraints,
    deadline: opportunity.deadline,
    applicationOrParticipationWindow: opportunity.applicationWindow,
    risksBlockers,
    providerQuestions,
    preparationChecklist,
    recommendedNextAction,
    readinessState,
    readinessScore,
    evidenceSourceReferences,
    estimatedVsConfirmedFinancialValues: financial,
    requirementResults,
    preparationMissions,
    externalActionsExecuted: false,
    durableMemoryWritten: false,
    persistence: 'session_only',
  }

  return { ...cardBase, fieldBriefFacts: buildFieldBrief(cardBase) }
}
