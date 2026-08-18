import type { CommanderReadinessCard } from '@/lib/opportunity-readiness/types'
import { deriveMissionStatusFromReadinessCard } from './bridgeEngine'
import type { CommanderFieldBrief, CommanderFieldBriefResult, FieldBriefAvailability } from './types'

const REPORT_BACK_INSTRUCTIONS =
  'After field action, return to this opportunity and file a report-back: attended/completed status, provider response, time spent, costs, and any compensation promised or received. Reporting completion or receiving pay does not by itself verify income — only a matched, confirmed deposit closes that loop.'

function availabilityFor(card: Pick<CommanderReadinessCard, 'readinessState'>): FieldBriefAvailability {
  switch (card.readinessState) {
    case 'READY_NOW':
      return 'FULL_FIELD_BRIEF'
    case 'READY_WITH_PREP':
    case 'DOCUMENTATION_NEEDED':
    case 'TRAINING_REQUIRED':
    case 'LOCATION_CONSTRAINT':
      return 'PREPARATION_BRIEF'
    default:
      return 'NOT_AVAILABLE'
  }
}

function unavailableReasonFor(card: Pick<CommanderReadinessCard, 'readinessState' | 'recommendedNextAction'>): string {
  switch (card.readinessState) {
    case 'NOT_CURRENTLY_ELIGIBLE':
      return 'A hard eligibility blocker is unresolved. No field brief will be generated until it is resolved or confirmed changeable.'
    case 'BLOCKED':
      return 'This opportunity is blocked (its deadline has passed or it has otherwise become inactionable). No field brief will be generated.'
    case 'ELIGIBILITY_UNCONFIRMED':
      return 'Eligibility has not been confirmed — requirements are unresearched or unresolved. No field brief will be generated until readiness is re-assessed with more information.'
    case 'OPERATOR_INPUT_REQUIRED':
      return 'Commander input is required to resolve outstanding requirements before a field brief can be generated.'
    case 'QUALIFICATION_GAP':
      return 'A confirmed qualification gap exists with no automatic preparation path. Commander review is required before a field brief can be generated.'
    case 'DEFERRED':
      return 'This opportunity is deferred. No field brief is generated while deferred.'
    default:
      return card.recommendedNextAction
  }
}

/**
 * Builds the Phase 49-I Commander Field Brief by composing the existing
 * Phase 49-D CommanderReadinessCard (and its already-gated `fieldBriefFacts`)
 * with mission-bridge identity/status fields. This performs no additional
 * eligibility inference — every fact not already confirmed by the readiness
 * engine stays null/UNKNOWN/[] here too.
 */
export function buildCommanderFieldBrief(opportunityId: string, card: CommanderReadinessCard, now: () => string = () => new Date().toISOString()): CommanderFieldBriefResult {
  const availability = availabilityFor(card)
  const missionStatus = deriveMissionStatusFromReadinessCard(card)

  if (availability === 'NOT_AVAILABLE') {
    return { available: 'NOT_AVAILABLE', brief: null, unavailableReason: unavailableReasonFor(card) }
  }

  const facts = card.fieldBriefFacts
  const unresolvedQuestions = card.commanderQuestions.map(q => q.question)

  const brief: CommanderFieldBrief = {
    opportunityId,
    opportunityTitle: card.opportunityName,
    provider: card.providerEmployer,
    opportunityType: card.opportunityType,
    readinessState: card.readinessState,
    missionStatus,
    location: card.location,
    modality: card.workMode,
    dateTimeWindow: card.applicationOrParticipationWindow,
    deadline: card.deadline,
    compensation: card.compensation,
    compensationBasis: card.compensationBasis,
    expectedTimeCommitment: card.estimatedTimeCommitment,
    effectiveHourlyEstimate: card.estimatedEffectiveHourlyValue,
    requiredDocuments: card.requiredDocuments,
    requiredCredentials: [...card.requiredCredentials, ...card.requiredCertifications],
    requiredEquipment: card.requiredEquipment,
    preparationChecklist: card.preparationChecklist,
    providerQuestions: card.providerQuestions,
    commanderQuestions: card.commanderQuestions,
    travelNotes: card.travelLocationConstraints,
    whatToBring: facts?.whatToBring ?? [],
    whatToExpect: facts?.whatToExpect ?? 'UNKNOWN — not yet supported by a confirmed READY_NOW/READY_WITH_PREP assessment.',
    whatToAsk: facts?.whatToAsk ?? [],
    successCheckpoint: facts?.successCheckpoint ?? 'UNKNOWN',
    reportBackInstructions: REPORT_BACK_INSTRUCTIONS,
    unresolvedQuestions,
    evidenceRefs: card.evidenceSourceReferences,
    generatedAt: now(),
    externalActionsExecuted: false,
    durableMemoryWritten: false,
  }

  return { available: availability, brief, unavailableReason: null }
}
