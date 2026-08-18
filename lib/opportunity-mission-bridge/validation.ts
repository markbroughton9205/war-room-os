import { COMPENSATION_PERIODS, CONFIRMATION_BASES, type CompensationInput } from '@/lib/opportunity-readiness/types'
import { BRIDGE_INPUT_LIMITS, REPORT_BACK_OUTCOMES, REPORT_BACK_PAYMENT_STATUSES, type ReportBackInput } from './types'

/**
 * Pure request-body validation for POST /api/opportunity-mission-bridge,
 * extracted from the route handler so every rejection is independently
 * testable without a Request object, a Commander session, or the store.
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
function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}
function isNonNegativeFiniteOrNull(value: unknown): value is number | null {
  return isFiniteOrNull(value) && (value === null || value >= 0)
}

export function validateOpportunityId(value: unknown): ValidationResult<string> {
  if (!isBoundedString(value, BRIDGE_INPUT_LIMITS.MAX_ID_LENGTH)) return fail('opportunityId must be a non-empty, bounded string.')
  return ok(value)
}

function validateOptionalCompensationInput(value: unknown, path: string): ValidationResult<CompensationInput | null> {
  if (value === undefined || value === null) return ok(null)
  if (typeof value !== 'object') return fail(`${path} must be an object or null.`)
  const v = value as Record<string, unknown>
  if (!isFiniteOrNull(v.amount)) return fail(`${path}.amount must be a finite number or null.`)
  if (!isBoundedString(v.currency, 20)) return fail(`${path}.currency must be a non-empty string.`)
  if (typeof v.basis !== 'string' || !(CONFIRMATION_BASES as readonly string[]).includes(v.basis)) return fail(`${path}.basis must be CONFIRMED, ESTIMATED, or UNKNOWN.`)
  if (typeof v.per !== 'string' || !(COMPENSATION_PERIODS as readonly string[]).includes(v.per)) return fail(`${path}.per must be one of ${COMPENSATION_PERIODS.join(', ')}.`)
  if (v.notes !== undefined && !isBoundedNullableString(v.notes, BRIDGE_INPUT_LIMITS.MAX_NOTES_LENGTH)) return fail(`${path}.notes must be a string or null.`)
  return ok(value as CompensationInput)
}

function validateEvidenceRefs(value: unknown): ValidationResult<string[]> {
  if (value === undefined) return ok([])
  if (!Array.isArray(value)) return fail('evidenceRefs must be an array of strings.')
  if (value.length > BRIDGE_INPUT_LIMITS.MAX_LIST_ENTRIES) return fail(`evidenceRefs exceeds the maximum of ${BRIDGE_INPUT_LIMITS.MAX_LIST_ENTRIES} entries.`)
  for (const item of value) {
    if (!isBoundedString(item, BRIDGE_INPUT_LIMITS.MAX_TEXT_LENGTH)) return fail('Every evidenceRefs entry must be a non-empty, bounded string.')
  }
  return ok(value as string[])
}

export function validateReportBackInput(value: unknown): ValidationResult<ReportBackInput> {
  if (!value || typeof value !== 'object') return fail('report-back payload must be an object.')
  const v = value as Record<string, unknown>

  const opportunityId = validateOpportunityId(v.opportunityId)
  if (!opportunityId.ok) return fail(opportunityId.reason)

  if (typeof v.outcome !== 'string' || !(REPORT_BACK_OUTCOMES as readonly string[]).includes(v.outcome)) {
    return fail(`outcome must be one of ${REPORT_BACK_OUTCOMES.join(', ')}.`)
  }
  if (v.providerResponse !== undefined && !isBoundedNullableString(v.providerResponse, BRIDGE_INPUT_LIMITS.MAX_TEXT_LENGTH)) return fail('providerResponse must be a string or null.')
  if (v.timeSpentMinutes !== undefined && !isNonNegativeFiniteOrNull(v.timeSpentMinutes)) return fail('timeSpentMinutes must be a non-negative finite number or null.')
  if (v.timeSpentMinutes !== undefined && typeof v.timeSpentMinutes === 'number' && v.timeSpentMinutes > 100000) return fail('timeSpentMinutes exceeds a plausible bound.')
  if (v.travelCost !== undefined && !isNonNegativeFiniteOrNull(v.travelCost)) return fail('travelCost must be a non-negative finite number or null.')
  if (v.otherCosts !== undefined && !isNonNegativeFiniteOrNull(v.otherCosts)) return fail('otherCosts must be a non-negative finite number or null.')

  const compensationPromised = validateOptionalCompensationInput(v.compensationPromised, 'compensationPromised')
  if (!compensationPromised.ok) return fail(compensationPromised.reason)
  const compensationReceivedClaim = validateOptionalCompensationInput(v.compensationReceivedClaim, 'compensationReceivedClaim')
  if (!compensationReceivedClaim.ok) return fail(compensationReceivedClaim.reason)

  if (typeof v.paymentStatus !== 'string' || !(REPORT_BACK_PAYMENT_STATUSES as readonly string[]).includes(v.paymentStatus)) {
    return fail(`paymentStatus must be one of ${REPORT_BACK_PAYMENT_STATUSES.join(', ')}.`)
  }

  const evidenceRefs = validateEvidenceRefs(v.evidenceRefs)
  if (!evidenceRefs.ok) return fail(evidenceRefs.reason)

  if (v.commanderNotes !== undefined && !isBoundedNullableString(v.commanderNotes, BRIDGE_INPUT_LIMITS.MAX_NOTES_LENGTH)) return fail('commanderNotes must be a string or null.')

  return ok({
    opportunityId: opportunityId.value,
    outcome: v.outcome as ReportBackInput['outcome'],
    providerResponse: (v.providerResponse as string | null) ?? null,
    timeSpentMinutes: (v.timeSpentMinutes as number | null) ?? null,
    travelCost: (v.travelCost as number | null) ?? null,
    otherCosts: (v.otherCosts as number | null) ?? null,
    compensationPromised: compensationPromised.value,
    compensationReceivedClaim: compensationReceivedClaim.value,
    paymentStatus: v.paymentStatus as ReportBackInput['paymentStatus'],
    evidenceRefs: evidenceRefs.value,
    commanderNotes: (v.commanderNotes as string | null) ?? null,
  })
}
