import type { RecurringDevelopmentGap, RequirementResult } from './types'

/**
 * Session-only observation log. Nothing here is a durable store — it lives for
 * the lifetime of the process/session, matches the pattern used by
 * lib/opportunity-agents/store.ts, and is reset with __resetDevelopmentGapLog
 * (used by tests and safe to call any time).
 *
 * Bounded two ways so re-assessing the same opportunities repeatedly cannot
 * grow this array without limit: (1) re-observing the same opportunity+gap
 * pair updates the existing entry in place instead of appending a duplicate,
 * and (2) a hard cap evicts the oldest entries if it is ever exceeded (e.g.
 * from a very large number of distinct opportunities).
 */
type GapObservation = {
  dedupeKey: string
  opportunityId: string
  requirementText: string
  category: string
  compensationAmount: number | null
  compensationCurrency: string | null
  observedAt: string
}

const observations: GapObservation[] = []

const RECURRING_THRESHOLD = 3
const MAX_OBSERVATIONS = 5000

function normalizeSkillKey(text: string): string {
  return text.trim().toLowerCase()
}

export function recordGapObservations(
  opportunityId: string,
  requirementResults: RequirementResult[],
  compensationAmount: number | null,
  compensationCurrency: string | null,
): void {
  const gapClassifications: RequirementResult['classification'][] = [
    'CONFIRMED_NOT_MET',
    'TRAINING_REQUIRED',
    'CREDENTIAL_REQUIRED',
  ]
  for (const result of requirementResults) {
    if (!gapClassifications.includes(result.classification)) continue
    const dedupeKey = `${opportunityId}::${normalizeSkillKey(result.requirementText)}`
    const existing = observations.find(item => item.dedupeKey === dedupeKey)
    if (existing) {
      existing.compensationAmount = compensationAmount
      existing.compensationCurrency = compensationCurrency
      existing.observedAt = new Date().toISOString()
      continue
    }
    observations.push({
      dedupeKey,
      opportunityId,
      requirementText: result.requirementText,
      category: result.category,
      compensationAmount,
      compensationCurrency,
      observedAt: new Date().toISOString(),
    })
  }
  if (observations.length > MAX_OBSERVATIONS) {
    observations.splice(0, observations.length - MAX_OBSERVATIONS)
  }
}

/** Evidence-based: a skill is only reported as a recurring gap once it has been
 * observed missing across at least RECURRING_THRESHOLD distinct opportunities.
 * Suggesting a mission here never marks the skill as learned. */
export function detectRecurringGaps(): RecurringDevelopmentGap[] {
  const bySkill = new Map<string, GapObservation[]>()
  for (const observation of observations) {
    const key = normalizeSkillKey(observation.requirementText)
    const bucket = bySkill.get(key) ?? []
    bucket.push(observation)
    bySkill.set(key, bucket)
  }

  const gaps: RecurringDevelopmentGap[] = []
  for (const [, bucket] of bySkill) {
    const distinctOpportunities = new Set(bucket.map(item => item.opportunityId))
    if (distinctOpportunities.size < RECURRING_THRESHOLD) continue

    const amounts = bucket.map(item => item.compensationAmount).filter((value): value is number => value !== null)
    const currency = bucket.find(item => item.compensationCurrency !== null)?.compensationCurrency ?? null

    gaps.push({
      skill: bucket[0].requirementText,
      observedOpportunityCount: distinctOpportunities.size,
      observedOpportunityIds: Array.from(distinctOpportunities),
      compensationRangeObserved: {
        min: amounts.length ? Math.min(...amounts) : null,
        max: amounts.length ? Math.max(...amounts) : null,
        currency,
      },
      commonMissingRequirement: bucket[0].requirementText,
      suggestedDevelopmentMission: `${bucket[0].requirementText} Fundamentals`,
    })
  }
  return gaps.sort((a, b) => b.observedOpportunityCount - a.observedOpportunityCount)
}

export function __resetDevelopmentGapLog(): void {
  observations.length = 0
}

export const __constants = { RECURRING_THRESHOLD, MAX_OBSERVATIONS }
