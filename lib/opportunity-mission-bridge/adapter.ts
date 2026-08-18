import type { IncomeLootConsoleOpportunity } from '@/lib/income-loot/consoleViewModel'
import type { NormalizedOpportunityInput, RequirementInput } from '@/lib/opportunity-readiness/types'

/**
 * Read-only adapter from the existing EARN NOW / Income Loot opportunity
 * shape (Phase 49-G) into the Commander Qualification & Readiness Engine's
 * normalized input shape (Phase 49-D) — the same role adapters.ts already
 * plays for the Opportunity Agent Workforce store. This module never writes
 * to lib/income-loot and never mutates the opportunity it reads; it is a
 * pure client-safe (no node:fs, no server-only import) shape translation so
 * the browser can attach the already-rendered opportunity directly to the
 * `opportunity` field of POST /api/opportunity-readiness/assess without a
 * second server round-trip and without a second opportunity source of truth.
 */
export function fromIncomeLootOpportunity(item: IncomeLootConsoleOpportunity): NormalizedOpportunityInput {
  const eligibilityRequirements: RequirementInput[] = item.eligibility.map((text, index) => ({
    id: `${item.id}-eligibility-${index}`,
    text,
    category: 'other',
    factRef: null,
  }))
  const evidenceRequirements: RequirementInput[] = item.evidenceRequirement.map((text, index) => ({
    id: `${item.id}-evidence-${index}`,
    text,
    category: 'document',
    factRef: null,
  }))

  const reward = item.estimatedReward
  const compensationBasis = reward && reward.amount !== null ? (reward.basis === 'ESTIMATED' ? 'ESTIMATED' as const : 'CONFIRMED' as const) : 'UNKNOWN' as const

  return {
    id: item.id,
    title: item.title,
    provider: item.provider || null,
    opportunityType: item.category.toLowerCase(),
    source: item.provenance[0]?.sourceAdapterId ?? null,
    sourceUrl: item.externalUrl,
    location: item.locationRequirement,
    // EARN NOW opportunities do not currently carry a modality field —
    // never inferred from location text; stays unknown per Phase 49-I truth rules.
    workMode: 'unknown',
    compensation: {
      amount: reward?.amount ?? null,
      currency: reward?.currency ?? 'USD',
      basis: compensationBasis,
      per: 'per_task',
      notes: reward?.notes || null,
    },
    timeCommitment: {
      hoursPerWeek: null,
      totalHoursEstimate: item.estimatedTimeMinutes !== null ? item.estimatedTimeMinutes / 60 : null,
      basis: item.estimatedTimeMinutes !== null ? 'ESTIMATED' : 'UNKNOWN',
    },
    knownCosts: null,
    requirements: [...eligibilityRequirements, ...evidenceRequirements],
    // Conservative by design, same rationale as fromOpportunityAgentRecord:
    // a non-empty eligibility/evidence array is not a positive assertion that
    // requirements research is complete.
    requirementsResearched: false,
    deadline: item.expiresAt,
    applicationWindow: null,
    employmentClassification: 'unknown',
    trainingPaid: 'unknown',
    equipmentProvided: 'unknown',
    scheduleFixed: 'unknown',
    paymentMethodKnown: false,
    notes: item.description,
  }
}
