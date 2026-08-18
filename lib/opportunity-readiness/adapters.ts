import type { OpportunityRecord, RevenueFigure } from '@/lib/opportunity-agents/types'
import type { CompensationInput, KnownCostsInput, NormalizedOpportunityInput, RequirementInput } from './types'

/** Read-only adapter from the existing Phase 49-C Opportunity Agent Workforce
 * store into this module's normalized input shape. This module never mutates
 * an OpportunityRecord and never writes back to lib/opportunity-agents — it
 * only reads the already-collected record to avoid a second source of truth. */

function revenueToCompensation(figure: RevenueFigure | null): CompensationInput {
  if (!figure || figure.amount === null) {
    return { amount: null, currency: figure?.currency ?? 'USD', basis: 'UNKNOWN', per: 'flat_total', notes: figure?.notes ?? null }
  }
  return {
    amount: figure.amount,
    currency: figure.currency,
    basis: figure.basis === 'confirmed' ? 'CONFIRMED' : 'ESTIMATED',
    per: 'flat_total',
    notes: figure.notes || null,
  }
}

function revenueToCosts(figure: RevenueFigure | null): KnownCostsInput | null {
  if (!figure || figure.amount === null) return null
  return {
    travelCost: null,
    equipmentCost: null,
    fees: figure.amount,
    currency: figure.currency,
    basis: figure.basis === 'confirmed' ? 'CONFIRMED' : 'ESTIMATED',
  }
}

export function fromOpportunityAgentRecord(record: OpportunityRecord): NormalizedOpportunityInput {
  const requirements: RequirementInput[] = record.eligibility.map((text, index) => ({
    id: `${record.id}-req-${index}`,
    text,
    category: 'other',
    factRef: null,
  }))

  const missingNote = record.missingRequirements.length
    ? `Opportunity Agent Workforce previously flagged as missing: ${record.missingRequirements.join('; ')}. This is prior-agent evidence, not a Commander-confirmed fact — it does not resolve any requirement above.`
    : null

  return {
    id: record.id,
    title: record.title,
    provider: null,
    opportunityType: record.category,
    source: record.source,
    sourceUrl: record.sourceUrl,
    location: record.location ?? record.placeOfPerformance,
    workMode: 'unknown',
    compensation: revenueToCompensation(record.opportunityValue ?? record.estimatedRevenue),
    timeCommitment: { hoursPerWeek: null, totalHoursEstimate: null, basis: 'UNKNOWN' },
    knownCosts: revenueToCosts(record.estimatedCosts),
    requirements,
    // Conservative by design: Phase 49-C's eligibility array is not a
    // positive confirmation that requirements research is complete, so an
    // empty array here must not be treated as a verified all-clear.
    requirementsResearched: false,
    deadline: record.deadline,
    applicationWindow: null,
    employmentClassification: 'unknown',
    trainingPaid: 'unknown',
    equipmentProvided: 'unknown',
    scheduleFixed: 'unknown',
    paymentMethodKnown: false,
    notes: missingNote,
  }
}
