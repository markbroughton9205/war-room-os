import type {
  AssessmentInput,
  CommanderFacts,
  KnownCostsInput,
  NormalizedOpportunityInput,
} from './types'
import { CONFIRMATION_BASES, COMPENSATION_PERIODS, COMMANDER_FACT_STATUSES, INPUT_LIMITS } from './types'

/**
 * Pure request-body validation for POST /api/opportunity-readiness/assess,
 * extracted out of the route handler so it can be exercised directly with
 * constructed payloads — no Request object, no Commander session, no
 * network — rather than only being provable via source-text inspection.
 * Every rejection carries a specific, human-readable reason.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value }
}
function fail<T>(reason: string): ValidationResult<T> {
  return { ok: false, reason }
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}
function isBoundedNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || isBoundedString(value, maxLength)
}

function isConfirmationBasis(value: unknown): value is 'CONFIRMED' | 'ESTIMATED' | 'UNKNOWN' {
  return typeof value === 'string' && (CONFIRMATION_BASES as readonly string[]).includes(value)
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

export function validateCompensationInput(value: unknown): ValidationResult<NormalizedOpportunityInput['compensation']> {
  if (!value || typeof value !== 'object') return fail('compensation must be an object.')
  const v = value as Record<string, unknown>
  if (!isFiniteOrNull(v.amount)) return fail('compensation.amount must be a finite number or null.')
  if (!isBoundedString(v.currency, INPUT_LIMITS.MAX_CATEGORY_LENGTH)) return fail('compensation.currency must be a non-empty string.')
  if (!isConfirmationBasis(v.basis)) return fail('compensation.basis must be CONFIRMED, ESTIMATED, or UNKNOWN.')
  if (typeof v.per !== 'string' || !(COMPENSATION_PERIODS as readonly string[]).includes(v.per)) return fail(`compensation.per must be one of ${COMPENSATION_PERIODS.join(', ')}.`)
  if (v.notes !== undefined && !isBoundedNullableString(v.notes, INPUT_LIMITS.MAX_NOTES_LENGTH)) return fail('compensation.notes must be a string or null.')
  return ok(value as NormalizedOpportunityInput['compensation'])
}

export function validateTimeCommitmentInput(value: unknown): ValidationResult<NormalizedOpportunityInput['timeCommitment']> {
  if (!value || typeof value !== 'object') return fail('timeCommitment must be an object.')
  const v = value as Record<string, unknown>
  if (!isFiniteOrNull(v.hoursPerWeek)) return fail('timeCommitment.hoursPerWeek must be a finite number or null.')
  if (!isFiniteOrNull(v.totalHoursEstimate)) return fail('timeCommitment.totalHoursEstimate must be a finite number or null.')
  if (!isConfirmationBasis(v.basis)) return fail('timeCommitment.basis must be CONFIRMED, ESTIMATED, or UNKNOWN.')
  return ok(value as NormalizedOpportunityInput['timeCommitment'])
}

export function validateKnownCostsInput(value: unknown): ValidationResult<KnownCostsInput | null> {
  if (value === undefined || value === null) return ok(null)
  if (typeof value !== 'object') return fail('knownCosts must be an object or null.')
  const v = value as Record<string, unknown>
  if (!isFiniteOrNull(v.travelCost)) return fail('knownCosts.travelCost must be a finite number or null.')
  if (!isFiniteOrNull(v.equipmentCost)) return fail('knownCosts.equipmentCost must be a finite number or null.')
  if (!isFiniteOrNull(v.fees)) return fail('knownCosts.fees must be a finite number or null.')
  if (!isBoundedString(v.currency, INPUT_LIMITS.MAX_CATEGORY_LENGTH)) return fail('knownCosts.currency must be a non-empty string.')
  if (!isConfirmationBasis(v.basis)) return fail('knownCosts.basis must be CONFIRMED, ESTIMATED, or UNKNOWN.')
  return ok(value as KnownCostsInput)
}

function validateFactReference(value: unknown, path: string): ValidationResult<NormalizedOpportunityInput['requirements'][number]['factRef']> {
  if (value === null) return ok(null)
  if (!value || typeof value !== 'object') return fail(`${path}.factRef must be an object or null.`)
  const v = value as Record<string, unknown>
  if (!isBoundedString(v.factId, INPUT_LIMITS.MAX_ID_LENGTH)) return fail(`${path}.factRef.factId must be a non-empty string.`)
  if (!isBoundedString(v.category, INPUT_LIMITS.MAX_CATEGORY_LENGTH)) return fail(`${path}.factRef.category must be a non-empty string.`)
  if (v.trustedShared !== undefined && typeof v.trustedShared !== 'boolean') return fail(`${path}.factRef.trustedShared must be a boolean.`)
  return ok(value as NormalizedOpportunityInput['requirements'][number]['factRef'])
}

export function validateRequirementArray(value: unknown): ValidationResult<NormalizedOpportunityInput['requirements']> {
  if (!Array.isArray(value)) return fail('requirements must be an array.')
  if (value.length > INPUT_LIMITS.MAX_REQUIREMENTS) return fail(`requirements array exceeds the maximum of ${INPUT_LIMITS.MAX_REQUIREMENTS} entries.`)

  const seenIds = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    const path = `requirements[${index}]`
    if (!item || typeof item !== 'object') return fail(`${path} must be an object.`)
    const v = item as Record<string, unknown>
    if (!isBoundedString(v.id, INPUT_LIMITS.MAX_ID_LENGTH)) return fail(`${path}.id must be a non-empty string.`)
    if (seenIds.has(v.id as string)) return fail(`${path} has a duplicate requirement id '${v.id as string}'. Requirement ids must be unique within one assessment.`)
    seenIds.add(v.id as string)
    if (!isBoundedString(v.text, INPUT_LIMITS.MAX_TEXT_LENGTH)) return fail(`${path}.text must be a non-empty string.`)
    if (!isBoundedString(v.category, INPUT_LIMITS.MAX_CATEGORY_LENGTH)) return fail(`${path}.category must be a non-empty string.`)
    const factRef = validateFactReference(v.factRef ?? null, path)
    if (!factRef.ok) return fail(factRef.reason)
    if (v.hardBlocking !== undefined && typeof v.hardBlocking !== 'boolean') return fail(`${path}.hardBlocking must be a boolean.`)
  }
  return ok(value as NormalizedOpportunityInput['requirements'])
}

export function validateNormalizedOpportunityInput(value: unknown): ValidationResult<NormalizedOpportunityInput> {
  if (!value || typeof value !== 'object') return fail('opportunity must be an object.')
  const v = value as Record<string, unknown>

  if (!isBoundedString(v.id, INPUT_LIMITS.MAX_ID_LENGTH)) return fail('opportunity.id must be a non-empty string.')
  if (!isBoundedString(v.title, INPUT_LIMITS.MAX_TITLE_LENGTH)) return fail('opportunity.title must be a non-empty string.')
  if (!isBoundedString(v.opportunityType, INPUT_LIMITS.MAX_CATEGORY_LENGTH)) return fail('opportunity.opportunityType must be a non-empty string.')
  if (v.provider !== undefined && !isBoundedNullableString(v.provider, INPUT_LIMITS.MAX_FIELD_LENGTH)) return fail('opportunity.provider must be a string or null.')
  if (v.source !== undefined && !isBoundedNullableString(v.source, INPUT_LIMITS.MAX_FIELD_LENGTH)) return fail('opportunity.source must be a string or null.')
  if (v.sourceUrl !== undefined && !isBoundedNullableString(v.sourceUrl, INPUT_LIMITS.MAX_FIELD_LENGTH)) return fail('opportunity.sourceUrl must be a string or null.')
  if (v.location !== undefined && !isBoundedNullableString(v.location, INPUT_LIMITS.MAX_FIELD_LENGTH)) return fail('opportunity.location must be a string or null.')
  if (v.workMode !== undefined && !['remote', 'in_person', 'hybrid', 'unknown'].includes(v.workMode as string)) return fail('opportunity.workMode must be remote, in_person, hybrid, or unknown.')

  const compensation = validateCompensationInput(v.compensation)
  if (!compensation.ok) return fail(compensation.reason)
  const timeCommitment = validateTimeCommitmentInput(v.timeCommitment)
  if (!timeCommitment.ok) return fail(timeCommitment.reason)
  const knownCosts = validateKnownCostsInput(v.knownCosts)
  if (!knownCosts.ok) return fail(knownCosts.reason)
  const requirements = validateRequirementArray(v.requirements)
  if (!requirements.ok) return fail(requirements.reason)

  if (v.requirementsResearched !== undefined && typeof v.requirementsResearched !== 'boolean') return fail('opportunity.requirementsResearched must be a boolean.')
  if (!(typeof v.deadline === 'string' || v.deadline === null)) return fail('opportunity.deadline must be a string or null.')
  if (v.applicationWindow !== undefined && !isBoundedNullableString(v.applicationWindow, INPUT_LIMITS.MAX_FIELD_LENGTH)) return fail('opportunity.applicationWindow must be a string or null.')
  if (v.notes !== undefined && !isBoundedNullableString(v.notes, INPUT_LIMITS.MAX_NOTES_LENGTH)) return fail('opportunity.notes must be a string or null.')

  return ok({
    ...(value as NormalizedOpportunityInput),
    compensation: compensation.value,
    timeCommitment: timeCommitment.value,
    knownCosts: knownCosts.value,
    requirements: requirements.value,
  })
}

export function validateCommanderFacts(value: unknown): ValidationResult<CommanderFacts> {
  if (!value || typeof value !== 'object') return fail('commanderFacts must be an object.')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > INPUT_LIMITS.MAX_COMMANDER_FACTS) return fail(`commanderFacts exceeds the maximum of ${INPUT_LIMITS.MAX_COMMANDER_FACTS} entries.`)
  for (const [factId, entry] of entries) {
    if (factId.length > INPUT_LIMITS.MAX_ID_LENGTH) return fail(`commanderFacts key '${factId.slice(0, 40)}...' exceeds the maximum id length.`)
    if (!entry || typeof entry !== 'object') return fail(`commanderFacts['${factId}'] must be an object.`)
    const v = entry as Record<string, unknown>
    if (typeof v.status !== 'string' || !(COMMANDER_FACT_STATUSES as readonly string[]).includes(v.status)) return fail(`commanderFacts['${factId}'].status must be yes, no, or unknown.`)
    if (!isBoundedString(v.category, INPUT_LIMITS.MAX_CATEGORY_LENGTH)) return fail(`commanderFacts['${factId}'].category must be a non-empty string.`)
    if (v.detail !== undefined && !isBoundedNullableString(v.detail, INPUT_LIMITS.MAX_NOTES_LENGTH)) return fail(`commanderFacts['${factId}'].detail must be a string or null.`)
  }
  return ok(value as CommanderFacts)
}

export type ParsedAssessRequest =
  | { ok: true; value: { opportunity?: NormalizedOpportunityInput; opportunityId?: string; commanderFacts: CommanderFacts; commanderDecision: AssessmentInput['commanderDecision'] } }
  | { ok: false; status: number; message: string }

/**
 * Validates the already-JSON-parsed request body. Does not know about
 * authentication (that happens before this in the route) or about the
 * opportunity-agents store (the route resolves `opportunityId` itself, since
 * that requires a store this module intentionally does not depend on).
 */
export function parseAssessRequestBody(body: unknown): ParsedAssessRequest {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, message: 'Request body must be a JSON object.' }
  }
  const b = body as Record<string, unknown>

  let opportunity: NormalizedOpportunityInput | undefined
  if (b.opportunity !== undefined) {
    const validated = validateNormalizedOpportunityInput(b.opportunity)
    if (!validated.ok) return { ok: false, status: 400, message: `Invalid opportunity payload: ${validated.reason}` }
    opportunity = validated.value
  }

  let opportunityId: string | undefined
  if (opportunity === undefined && typeof b.opportunityId === 'string' && b.opportunityId.length > 0) {
    if (b.opportunityId.length > INPUT_LIMITS.MAX_ID_LENGTH) {
      return { ok: false, status: 400, message: 'opportunityId exceeds the maximum id length.' }
    }
    opportunityId = b.opportunityId
  }

  if (opportunity === undefined && opportunityId === undefined) {
    return { ok: false, status: 400, message: 'Provide either `opportunity` (normalized data) or `opportunityId` (existing record reference).' }
  }

  let commanderFacts: CommanderFacts = {}
  if (b.commanderFacts !== undefined) {
    const validated = validateCommanderFacts(b.commanderFacts)
    if (!validated.ok) return { ok: false, status: 400, message: `Invalid commanderFacts payload: ${validated.reason}` }
    commanderFacts = validated.value
  }

  const commanderDecision = b.commanderDecision === 'approve' || b.commanderDecision === 'defer' ? b.commanderDecision : null

  return { ok: true, value: { opportunity, opportunityId, commanderFacts, commanderDecision } }
}
