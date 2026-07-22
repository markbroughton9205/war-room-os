import {
  COUNCIL_REPAIR_GUARDRAILS,
  REPAIR_VALIDATION_COMMANDS,
  type CouncilRepairPacket,
  type RepairFamilyContribution,
} from './model'
import type { OperatorNextStepsReport } from '@/lib/operator/nextStepsReport'

export type CouncilRepairPacketValidationResult =
  | { valid: true; packet: CouncilRepairPacket }
  | { valid: false; errors: string[] }

const REPAIR_CLASSIFICATIONS = [
  'bug',
  'ui_issue',
  'provider_runtime_issue',
  'needs_scope',
  'supabase_schema_issue',
  'performance_issue',
  'routing_orchestration_issue',
  'council_prompt_issue',
  'security_truth_boundary_issue',
] as const

const REPAIR_APPROVAL_STATUSES = ['awaiting_commander_approval', 'approved_for_manual_cursor', 'rejected'] as const

const REPAIR_PACKET_STATUSES = [
  'detected',
  'analysis_required',
  'awaiting_council',
  'awaiting_red_team',
  'proposal_ready',
  'awaiting_commander',
  'approved',
  'rejected',
  'deferred',
  'repair_unavailable',
  'report_generated',
  'archived',
] as const

const REPAIR_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

const REPAIR_FAMILY_KEYS = ['chatgpt', 'claude', 'grok', 'gemini', 'red_team', 'baby_observer'] as const

const OPERATOR_NEXT_STEPS_FIELDS: Array<keyof OperatorNextStepsReport> = [
  'environmentChanges',
  'sqlMigrations',
  'restartRequirements',
  'verificationRoutes',
  'expectedSuccessOutput',
  'featureFlags',
  'uiChanges',
  'rollbackInstructions',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value))
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return isString(value) && (allowed as readonly string[]).includes(value)
}

/** Checks field-for-field equality against the literal guardrails constant — no partial or coerced guardrail object is accepted. */
function guardrailsMatch(value: unknown): value is CouncilRepairPacket['guardrails'] {
  if (!isRecord(value)) return false
  return (Object.keys(COUNCIL_REPAIR_GUARDRAILS) as Array<keyof typeof COUNCIL_REPAIR_GUARDRAILS>).every(
    key => value[key] === COUNCIL_REPAIR_GUARDRAILS[key],
  )
}

function validationCommandsMatch(value: unknown): value is CouncilRepairPacket['validationCommands'] {
  return (
    Array.isArray(value)
    && value.length === REPAIR_VALIDATION_COMMANDS.length
    && REPAIR_VALIDATION_COMMANDS.every((command, index) => value[index] === command)
  )
}

function isFamilyContribution(value: unknown, path: string, errors: string[]): value is RepairFamilyContribution {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`)
    return false
  }
  let ok = true
  if (!isOneOf(value.family, REPAIR_FAMILY_KEYS)) { errors.push(`${path}.family must be one of ${REPAIR_FAMILY_KEYS.join(', ')}.`); ok = false }
  if (!isString(value.label)) { errors.push(`${path}.label must be a string.`); ok = false }
  if (!isString(value.role)) { errors.push(`${path}.role must be a string.`); ok = false }
  if (!isString(value.contribution)) { errors.push(`${path}.contribution must be a string.`); ok = false }
  if (value.approvalRequired !== true) { errors.push(`${path}.approvalRequired must be true.`); ok = false }
  if (value.canExecute !== false) { errors.push(`${path}.canExecute must be false.`); ok = false }
  return ok
}

function isBabyLessonCandidate(value: unknown, errors: string[]): value is CouncilRepairPacket['babyLessonCandidate'] {
  if (!isRecord(value)) {
    errors.push('babyLessonCandidate must be an object.')
    return false
  }
  let ok = true
  if (!isString(value.id)) { errors.push('babyLessonCandidate.id must be a string.'); ok = false }
  if (!isString(value.summary)) { errors.push('babyLessonCandidate.summary must be a string.'); ok = false }
  if (value.source !== 'repair_outcome') { errors.push("babyLessonCandidate.source must be 'repair_outcome'."); ok = false }
  if (value.lessonState !== 'candidate') { errors.push("babyLessonCandidate.lessonState must be 'candidate'."); ok = false }
  if (value.commanderApprovalRequired !== true) { errors.push('babyLessonCandidate.commanderApprovalRequired must be true.'); ok = false }
  if (value.canExecute !== false) { errors.push('babyLessonCandidate.canExecute must be false.'); ok = false }
  return ok
}

function isSource(value: unknown, errors: string[]): value is CouncilRepairPacket['source'] {
  if (!isRecord(value)) {
    errors.push('source must be an object.')
    return false
  }
  let ok = true
  if (!isString(value.decree)) { errors.push('source.decree must be a string.'); ok = false }
  if (!isNullableString(value.sourceMessageId)) { errors.push('source.sourceMessageId must be a string or null.'); ok = false }
  if (!isNullableString(value.sourceFamily)) { errors.push('source.sourceFamily must be a string or null.'); ok = false }
  if (!isNullableString(value.sourceContent)) { errors.push('source.sourceContent must be a string or null.'); ok = false }
  if (!isString(value.packetSource)) { errors.push('source.packetSource must be a string.'); ok = false }
  return ok
}

function isOperatorNextSteps(value: unknown, errors: string[]): value is OperatorNextStepsReport {
  if (!isRecord(value)) {
    errors.push('operatorNextSteps must be an object.')
    return false
  }
  let ok = true
  for (const field of OPERATOR_NEXT_STEPS_FIELDS) {
    if (!isStringArray(value[field])) {
      errors.push(`operatorNextSteps.${field} must be a string array.`)
      ok = false
    }
  }
  return ok
}

/**
 * The single canonical CouncilRepairPacket runtime guard. Every required field and nested shape
 * from lib/council-repair/model.ts is checked explicitly — nothing is coerced, and a packet missing
 * or mistyping any field is rejected rather than treated as a partially-verified packet.
 */
export function validateCouncilRepairPacket(value: unknown): CouncilRepairPacketValidationResult {
  const errors: string[] = []

  if (!isRecord(value)) {
    return { valid: false, errors: ['Packet must be an object.'] }
  }

  if (!isString(value.id)) errors.push('id must be a string.')
  if (!isString(value.requestId)) errors.push('requestId must be a string.')
  if (!isString(value.title)) errors.push('title must be a string.')
  if (!isOneOf(value.classification, REPAIR_CLASSIFICATIONS)) errors.push(`classification must be one of ${REPAIR_CLASSIFICATIONS.join(', ')}.`)
  if (!isString(value.concreteIssue)) errors.push('concreteIssue must be a string.')
  if (!isString(value.affectedPanelRoute)) errors.push('affectedPanelRoute must be a string.')
  if (!isStringArray(value.evidence)) errors.push('evidence must be a string array.')
  isSource(value.source, errors)
  if (!isStringArray(value.observedSymptoms)) errors.push('observedSymptoms must be a string array.')
  if (!isString(value.suspectedRootCause)) errors.push('suspectedRootCause must be a string.')
  if (!isStringArray(value.filesRoutesToInspect)) errors.push('filesRoutesToInspect must be a string array.')
  if (!isStringArray(value.recommendedFix)) errors.push('recommendedFix must be a string array.')
  if (!validationCommandsMatch(value.validationCommands)) errors.push('validationCommands must exactly match the required validation command sequence.')
  if (!isStringArray(value.riskNotes)) errors.push('riskNotes must be a string array.')
  if (!isStringArray(value.rollbackNotes)) errors.push('rollbackNotes must be a string array.')
  if (!isStringArray(value.rollbackPlan)) errors.push('rollbackPlan must be a string array.')
  if (!isOneOf(value.approvalStatus, REPAIR_APPROVAL_STATUSES)) errors.push(`approvalStatus must be one of ${REPAIR_APPROVAL_STATUSES.join(', ')}.`)
  if (!isOneOf(value.status, REPAIR_PACKET_STATUSES)) errors.push(`status must be one of ${REPAIR_PACKET_STATUSES.join(', ')}.`)
  if (!isString(value.sourcePanel)) errors.push('sourcePanel must be a string.')
  if (!isNullableString(value.sourceEventId)) errors.push('sourceEventId must be a string or null.')
  if (!isString(value.summary)) errors.push('summary must be a string.')
  if (!isOneOf(value.severity, REPAIR_SEVERITIES)) errors.push(`severity must be one of ${REPAIR_SEVERITIES.join(', ')}.`)
  if (!isTimestamp(value.detectedAt)) errors.push('detectedAt must be a valid timestamp string.')
  if (!isTimestamp(value.lastObservedAt)) errors.push('lastObservedAt must be a valid timestamp string.')
  if (!isString(value.affectedSubsystem)) errors.push('affectedSubsystem must be a string.')
  if (!isString(value.securityImpact)) errors.push('securityImpact must be a string.')
  if (!isString(value.userImpact)) errors.push('userImpact must be a string.')
  if (!isString(value.reliabilityImpact)) errors.push('reliabilityImpact must be a string.')
  if (!isString(value.councilRecommendation)) errors.push('councilRecommendation must be a string.')
  if (!isString(value.redTeamRecommendation)) errors.push('redTeamRecommendation must be a string.')
  if (!isString(value.proposedRepair)) errors.push('proposedRepair must be a string.')
  if (!isStringArray(value.verificationRequirements)) errors.push('verificationRequirements must be a string array.')

  if (!Array.isArray(value.familyContributions)) {
    errors.push('familyContributions must be an array.')
  } else {
    value.familyContributions.forEach((contribution, index) => isFamilyContribution(contribution, `familyContributions[${index}]`, errors))
  }

  isFamilyContribution(value.riskReview, 'riskReview', errors)
  isBabyLessonCandidate(value.babyLessonCandidate, errors)

  if (!isStringArray(value.connectedSurfaces)) errors.push('connectedSurfaces must be a string array.')
  if (!guardrailsMatch(value.guardrails)) errors.push('guardrails must exactly match the required advisory-only guardrail values.')
  if (!isString(value.cursorReadyPrompt)) errors.push('cursorReadyPrompt must be a string.')
  isOperatorNextSteps(value.operatorNextSteps, errors)
  if (!isString(value.operatorNextStepsMarkdown)) errors.push('operatorNextStepsMarkdown must be a string.')
  if (!isTimestamp(value.createdAt)) errors.push('createdAt must be a valid timestamp string.')

  if (errors.length) return { valid: false, errors }
  return { valid: true, packet: value as unknown as CouncilRepairPacket }
}
