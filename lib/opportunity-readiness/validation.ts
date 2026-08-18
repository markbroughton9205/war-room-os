import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AssessmentInput, CommanderFacts, NormalizedOpportunityInput, RequirementInput } from './types'
import { assessOpportunityReadiness } from './readinessEngine'
import { analyzeFinancials } from './financialAnalysis'
import { matchRequirements, matchRequirement, isHardBlocking, normalizeCategory } from './requirementMatcher'
import { buildCommanderQuestions } from './commanderQuestions'
import { buildPreparationMissions } from './preparationMission'
import { __resetDevelopmentGapLog, detectRecurringGaps, recordGapObservations } from './developmentGapDetector'
import { parseAssessRequestBody, validateNormalizedOpportunityInput, validateCommanderFacts, validateRequirementArray } from './requestValidation'

export type OpportunityReadinessValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string): OpportunityReadinessValidationResult {
  try {
    const result = fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function asyncTest(id: string, fn: () => Promise<boolean | string>): Promise<OpportunityReadinessValidationResult> {
  try {
    const result = await fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function requirement(overrides: Partial<RequirementInput> = {}): RequirementInput {
  return { id: 'req-1', text: 'Valid driver license', category: 'license', factRef: { factId: 'driver_license.valid', category: 'license' }, ...overrides }
}

function opportunity(overrides: Partial<NormalizedOpportunityInput> = {}): NormalizedOpportunityInput {
  return {
    id: 'opp-1',
    title: 'Delivery route contractor',
    provider: 'Acme Logistics',
    opportunityType: 'local_gig',
    source: 'web_search',
    sourceUrl: 'https://example.com/opp-1',
    location: 'Columbus, OH',
    workMode: 'in_person',
    compensation: { amount: 22, currency: 'USD', basis: 'CONFIRMED', per: 'hour' },
    timeCommitment: { hoursPerWeek: 20, totalHoursEstimate: null, basis: 'CONFIRMED' },
    knownCosts: null,
    requirements: [requirement()],
    requirementsResearched: true,
    deadline: null,
    applicationWindow: null,
    employmentClassification: 'unknown',
    trainingPaid: 'unknown',
    equipmentProvided: 'unknown',
    scheduleFixed: 'unknown',
    paymentMethodKnown: false,
    notes: null,
    ...overrides,
  }
}

function fact(status: 'yes' | 'no' | 'unknown', category = 'license', detail: string | null = null) {
  return { status, category, detail }
}

function assess(overrides: Partial<NormalizedOpportunityInput> = {}, commanderFacts: CommanderFacts = {}, commanderDecision: AssessmentInput['commanderDecision'] = null): ReturnType<typeof assessOpportunityReadiness> {
  const input: AssessmentInput = { opportunity: opportunity(overrides), commanderFacts, commanderDecision }
  return assessOpportunityReadiness(input)
}

export function runOpportunityReadinessValidation(): OpportunityReadinessValidationResult[] {
  const results: OpportunityReadinessValidationResult[] = []
  const add = (id: string, fn: () => boolean | string) => results.push(test(id, fn))

  // ---------------------------------------------------------------------
  // HIGH 1 — matchKey/factRef collision
  // ---------------------------------------------------------------------
  add('opre_01_bare_factid_collision_does_not_cross_satisfy', () => {
    const reqA = requirement({ id: 'a', text: 'Valid EMT license', category: 'license', factRef: { factId: 'license_ok', category: 'license' } })
    const reqB = requirement({ id: 'b', text: 'Valid electrician license', category: 'license', factRef: { factId: 'license_ok', category: 'license' } })
    const facts: CommanderFacts = { license_ok: fact('yes', 'license', 'Has EMT license') }
    const results = matchRequirements([reqA, reqB], facts)
    return results[0].classification === 'CONFIRMED_MET' && results[1].classification !== 'CONFIRMED_MET'
      || `A=${results[0].classification} B=${results[1].classification}`
  })

  add('opre_02_trustedshared_allows_intentional_reuse', () => {
    const reqA = requirement({ id: 'a', text: 'Available weekends (site A)', category: 'schedule_availability', factRef: { factId: 'availability.weekend', category: 'schedule_availability', trustedShared: true } })
    const reqB = requirement({ id: 'b', text: 'Available weekends (site B)', category: 'schedule_availability', factRef: { factId: 'availability.weekend', category: 'schedule_availability', trustedShared: true } })
    const facts: CommanderFacts = { 'availability.weekend': fact('yes', 'schedule_availability') }
    const results = matchRequirements([reqA, reqB], facts)
    return results[0].classification === 'CONFIRMED_MET' && results[1].classification === 'CONFIRMED_MET'
      || `A=${results[0].classification} B=${results[1].classification}`
  })

  add('opre_02b_trustedshared_is_not_a_one_sided_grant', () => {
    // Regression for a second-review finding: trustedShared must be a
    // per-requirement SELF-assertion, not something one requirement can
    // unilaterally grant to another. reqA (work_authorization, trustedShared)
    // answers "no" for its own specific meaning; reqB is a DIFFERENT,
    // non-consenting work_authorization requirement sharing the same
    // factId+category but WITHOUT its own trustedShared. B must not inherit
    // A's CONFIRMED_NOT_MET (which would wrongly flip the whole assessment
    // to NOT_CURRENTLY_ELIGIBLE for a requirement B never opted into sharing).
    const reqA = requirement({ id: 'a', text: 'Authorized to work in US (W2 track)', category: 'work_authorization', factRef: { factId: 'wa_shared', category: 'work_authorization', trustedShared: true } })
    const reqB = requirement({ id: 'b', text: 'Authorized to work in Canada (separate 1099 track, unrelated)', category: 'work_authorization', factRef: { factId: 'wa_shared', category: 'work_authorization' } })
    const facts: CommanderFacts = { wa_shared: fact('no', 'work_authorization', 'Not authorized for the US W2 track specifically') }
    const results = matchRequirements([reqA, reqB], facts)
    return results[0].classification === 'CONFIRMED_NOT_MET' && results[1].classification !== 'CONFIRMED_NOT_MET' && results[1].classification !== 'CONFIRMED_MET'
      || `A=${results[0].classification} B=${results[1].classification} — B inherited A's unilateral trustedShared grant`
  })

  add('opre_02c_trustedshared_does_not_leak_through_a_middle_requirement', () => {
    // Three requirements share one factId+category with different text. Only
    // the MIDDLE one marks trustedShared:true. A third, later, non-consenting
    // requirement must not inherit the fact via the middle one's flag.
    const reqA = requirement({ id: 'a', text: 'Requirement Alpha', category: 'other', factRef: { factId: 'shared_key', category: 'other' } })
    const reqB = requirement({ id: 'b', text: 'Requirement Beta (unrelated)', category: 'other', factRef: { factId: 'shared_key', category: 'other', trustedShared: true } })
    const reqC = requirement({ id: 'c', text: 'Requirement Gamma (also unrelated)', category: 'other', factRef: { factId: 'shared_key', category: 'other' } })
    const facts: CommanderFacts = { shared_key: fact('yes', 'other', 'answer meant only for Alpha') }
    const results = matchRequirements([reqA, reqB, reqC], facts)
    return results[2].classification !== 'CONFIRMED_MET' || `C=${results[2].classification} — leaked through B's unilateral trustedShared`
  })

  add('opre_03_ambiguous_reuse_never_confirmed_met', () => {
    // The FIRST requirement to legitimately claim a factId is correctly
    // resolved from it. Only a LATER, differently-worded requirement that
    // collides on the same bare factId is treated as ambiguous — it must
    // never also resolve to CONFIRMED_MET off the first one's answer.
    const reqA = requirement({ id: 'a', text: 'Skill X', category: 'skill', factRef: { factId: 'shared', category: 'skill' } })
    const reqB = requirement({ id: 'b', text: 'Skill Y (different)', category: 'skill', factRef: { factId: 'shared', category: 'skill' } })
    const facts: CommanderFacts = { shared: fact('yes', 'skill') }
    const results = matchRequirements([reqA, reqB], facts)
    return results[0].classification === 'CONFIRMED_MET' && results[1].classification !== 'CONFIRMED_MET'
      || `A=${results[0].classification} B=${results[1].classification}`
  })

  add('opre_04_ambiguous_reuse_keeps_evidence_source', () => {
    const reqA = requirement({ id: 'a', text: 'Skill X', category: 'skill', factRef: { factId: 'shared2', category: 'skill' } })
    const reqB = requirement({ id: 'b', text: 'Skill Y (different)', category: 'skill', factRef: { factId: 'shared2', category: 'skill' } })
    const facts: CommanderFacts = { shared2: fact('yes', 'skill') }
    const results = matchRequirements([reqA, reqB], facts)
    return results[1].evidenceSource === 'ambiguous_fact_reuse' && results[1].evidenceSource.length > 0 || `evidenceSource=${results[1].evidenceSource}`
  })

  add('opre_05_identical_text_reuse_allowed_without_trustedshared', () => {
    const reqA = requirement({ id: 'a', text: 'Valid driver license', category: 'license', factRef: { factId: 'dl', category: 'license' } })
    const reqB = requirement({ id: 'b', text: 'Valid driver license', category: 'license', factRef: { factId: 'dl', category: 'license' } })
    const facts: CommanderFacts = { dl: fact('yes', 'license') }
    const results = matchRequirements([reqA, reqB], facts)
    return results[0].classification === 'CONFIRMED_MET' && results[1].classification === 'CONFIRMED_MET' || 'identical-text reuse was blocked'
  })

  add('opre_06_factref_category_inconsistent_with_requirement_category', () => {
    const req = requirement({ id: 'a', text: 'Odd requirement', category: 'license', factRef: { factId: 'x', category: 'equipment' } })
    const facts: CommanderFacts = { x: fact('yes', 'equipment') }
    const result = matchRequirement(req, facts)
    return result.classification !== 'CONFIRMED_MET' && result.evidenceSource === 'factref_category_inconsistent' || `classification=${result.classification} evidence=${result.evidenceSource}`
  })

  add('opre_07_stored_fact_category_mismatch_not_applied', () => {
    const req = requirement({ id: 'a', text: 'License req', category: 'license', factRef: { factId: 'y', category: 'license' } })
    const facts: CommanderFacts = { y: fact('yes', 'equipment') } // stored under a different declared category
    const result = matchRequirement(req, facts)
    return result.classification !== 'CONFIRMED_MET' && result.evidenceSource === 'fact_category_mismatch' || `classification=${result.classification} evidence=${result.evidenceSource}`
  })

  // ---------------------------------------------------------------------
  // HIGH 2 — hard-block downgrade
  // ---------------------------------------------------------------------
  add('opre_08_work_authorization_cannot_be_downgraded', () => {
    const req = requirement({ id: 'a', text: 'Must be authorized to work in the US', category: 'work_authorization', hardBlocking: false, factRef: { factId: 'wa', category: 'work_authorization' } })
    return isHardBlocking(req) === true || 'work_authorization was downgraded by hardBlocking:false'
  })

  add('opre_09_intrinsic_category_age_cannot_be_downgraded', () => {
    const req = requirement({ id: 'a', text: 'Must be 21+', category: 'age', hardBlocking: false, factRef: { factId: 'age21', category: 'age' } })
    return isHardBlocking(req) === true || 'age was downgraded by hardBlocking:false'
  })

  add('opre_10_non_hard_category_can_be_elevated', () => {
    const req = requirement({ id: 'a', text: 'Must own a food truck', category: 'equipment', hardBlocking: true, factRef: { factId: 'truck', category: 'equipment' } })
    return isHardBlocking(req) === true || 'explicit elevation to hard-blocking was not honored'
  })

  add('opre_11_hard_blocker_overrides_high_readiness_score', () => {
    const met = Array.from({ length: 9 }, (_, i) => requirement({ id: `r${i}`, text: `req ${i}`, category: 'other', factRef: { factId: `k${i}`, category: 'other' } }))
    const facts: CommanderFacts = Object.fromEntries(met.map(r => [r.factRef!.factId, fact('yes', 'other')]))
    const hard = requirement({ id: 'r-hard', text: 'Must be 21+', category: 'age', factRef: { factId: 'age21', category: 'age' } })
    facts.age21 = fact('no', 'age')
    const card = assess({ requirements: [...met, hard] }, facts)
    return card.readinessState === 'NOT_CURRENTLY_ELIGIBLE' && card.readinessScore === 90 || `state=${card.readinessState} score=${card.readinessScore}`
  })

  add('opre_12_hard_blocker_overrides_commander_defer', () => {
    const hard = requirement({ id: 'a', text: 'Must be 21+', category: 'age', factRef: { factId: 'age21', category: 'age' } })
    const card = assess({ requirements: [hard] }, { age21: fact('no', 'age') }, 'defer')
    return card.readinessState === 'NOT_CURRENTLY_ELIGIBLE' || `state=${card.readinessState}`
  })

  add('opre_13_hard_blocker_overrides_commander_approve', () => {
    const hard = requirement({ id: 'a', text: 'Must be 21+', category: 'age', factRef: { factId: 'age21', category: 'age' } })
    const card = assess({ requirements: [hard] }, { age21: fact('no', 'age') }, 'approve')
    return card.readinessState === 'NOT_CURRENTLY_ELIGIBLE' || `state=${card.readinessState}`
  })

  // ---------------------------------------------------------------------
  // MEDIUM 1 — category normalization
  // ---------------------------------------------------------------------
  add('opre_14_category_case_normalized_for_hard_block', () => {
    const req = requirement({ id: 'a', text: 'Must be 21+', category: 'Age', factRef: { factId: 'age21', category: 'Age' } })
    return isHardBlocking(req) === true || 'capitalized "Age" lost hard-block protection'
  })

  add('opre_15_category_case_normalized_for_documents', () => {
    const req = requirement({ id: 'a', text: 'Photo ID', category: 'Document', factRef: null })
    const card = assess({ requirements: [req] })
    return card.requiredDocuments.includes('Photo ID') || 'capitalized "Document" was not surfaced as a required document'
  })

  add('opre_15b_normalizeCategory_handles_separators', () => {
    return normalizeCategory('Work Authorization') === 'work_authorization' && normalizeCategory('WORK-AUTHORIZATION') === 'work_authorization' || 'separator/case normalization incorrect'
  })

  // ---------------------------------------------------------------------
  // HIGH 3 — negative / invalid financial values
  // ---------------------------------------------------------------------
  add('opre_16_negative_hourly_pay_rejected', () => {
    const result = analyzeFinancials({ amount: -20, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: 10, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    return result.hourlyEquivalent.value === null && result.compensation.amount === null || `hourly=${JSON.stringify(result.hourlyEquivalent)}`
  })

  add('opre_17_negative_weekly_hours_rejected', () => {
    const result = analyzeFinancials({ amount: 20, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: -10, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    return result.weeklyEquivalent.value === null && result.monthlyEquivalent.value === null && result.grossOpportunityValue.value === null
      || `weekly=${result.weeklyEquivalent.value} monthly=${result.monthlyEquivalent.value} gross=${result.grossOpportunityValue.value}`
  })

  add('opre_18_negative_travel_cost_excluded_not_fabricated', () => {
    const result = analyzeFinancials(
      { amount: 500, currency: 'USD', basis: 'CONFIRMED', per: 'flat_total' },
      { hoursPerWeek: null, totalHoursEstimate: 25, basis: 'CONFIRMED' },
      { travelCost: -50, equipmentCost: 0, fees: 0, currency: 'USD', basis: 'CONFIRMED' },
    )
    return result.knownCosts.value === 0 || `knownCosts=${result.knownCosts.value}` // negative travel excluded, remaining valid costs sum to 0
  })

  add('opre_19_zero_compensation_remains_valid', () => {
    const result = analyzeFinancials({ amount: 0, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: 10, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    return result.hourlyEquivalent.value === 0 && result.hourlyEquivalent.basis === 'CONFIRMED' || 'zero compensation was treated as invalid/unknown'
  })

  add('opre_20_zero_hours_remains_valid', () => {
    const result = analyzeFinancials({ amount: 20, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: 0, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    return result.weeklyEquivalent.value === 0 || `weekly=${result.weeklyEquivalent.value}`
  })

  add('opre_21_fractional_hours_correct', () => {
    const result = analyzeFinancials({ amount: 15, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: 12.5, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    return result.weeklyEquivalent.value === 187.5 || `weekly=${result.weeklyEquivalent.value}`
  })

  add('opre_22_enormous_finite_values_not_rejected', () => {
    const result = analyzeFinancials({ amount: 1e9, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: 40, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    return result.hourlyEquivalent.value === 1e9 && result.weeklyEquivalent.value === 4e10 || 'a large finite value was incorrectly rejected'
  })

  add('opre_23_non_finite_and_unknown_time_handled', () => {
    const nanResult = analyzeFinancials({ amount: NaN, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: 10, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    const unknownTime = analyzeFinancials({ amount: 20, currency: 'USD', basis: 'CONFIRMED', per: 'flat_total' }, { hoursPerWeek: null, totalHoursEstimate: null, basis: 'UNKNOWN' }, null)
    return nanResult.hourlyEquivalent.value === null && unknownTime.estimatedTotalTimeCommitmentHours.value === null
      || `nan=${nanResult.hourlyEquivalent.value} unknownTime=${unknownTime.estimatedTotalTimeCommitmentHours.value}`
  })

  add('opre_23b_confirmed_weekly_monthly_math_correct', () => {
    const result = analyzeFinancials({ amount: 15, currency: 'USD', basis: 'CONFIRMED', per: 'hour' }, { hoursPerWeek: 20, totalHoursEstimate: null, basis: 'CONFIRMED' }, null)
    const expectedMonthly = 300 * (52 / 12)
    return result.weeklyEquivalent.value === 300 && Math.abs((result.monthlyEquivalent.value ?? 0) - expectedMonthly) < 0.01 || 'weekly/monthly math incorrect'
  })

  // ---------------------------------------------------------------------
  // MEDIUM 2 — UNKNOWN basis must never carry a concrete value
  // ---------------------------------------------------------------------
  add('opre_24_unknown_basis_never_carries_a_value_timeCommitment', () => {
    const result = analyzeFinancials({ amount: 300, currency: 'USD', basis: 'CONFIRMED', per: 'flat_total' }, { hoursPerWeek: null, totalHoursEstimate: 10, basis: 'UNKNOWN' }, null)
    return result.hourlyEquivalent.basis === 'UNKNOWN' && result.hourlyEquivalent.value === null || `hourly=${JSON.stringify(result.hourlyEquivalent)}`
  })

  add('opre_24b_unknown_basis_never_carries_a_value_knownCosts', () => {
    const result = analyzeFinancials(
      { amount: 500, currency: 'USD', basis: 'CONFIRMED', per: 'flat_total' },
      { hoursPerWeek: null, totalHoursEstimate: 25, basis: 'CONFIRMED' },
      { travelCost: 50, equipmentCost: 0, fees: 0, currency: 'USD', basis: 'UNKNOWN' },
    )
    return result.knownCosts.value === null && result.expectedNetValue.value === null && result.effectiveHourlyReturn.value === null
      || `knownCosts=${result.knownCosts.value} net=${result.expectedNetValue.value} effHourly=${result.effectiveHourlyReturn.value}`
  })

  add('opre_24c_card_compensation_never_carries_a_value_under_unknown_basis', () => {
    // Regression for a second-review finding: readinessEngine.ts builds
    // card.compensation/compensationBasis by echoing financial.compensation
    // directly rather than through the money() helper, so a caller-supplied
    // {amount: 450, basis: 'UNKNOWN'} (a legal payload — the two fields are
    // independently type-checked) must not survive to the card as a visible
    // dollar figure under an UNKNOWN label.
    const card = assess({ compensation: { amount: 450, currency: 'USD', basis: 'UNKNOWN', per: 'hour' } })
    return card.compensation.value === null && card.compensationBasis === 'UNKNOWN'
      || `compensation=${JSON.stringify(card.compensation)} compensationBasis=${card.compensationBasis}`
  })

  // ---------------------------------------------------------------------
  // HIGH 4 / MEDIUM 3 — QUALIFICATION_GAP guidance, BLOCKED/DEFERRED next action
  // ---------------------------------------------------------------------
  add('opre_25_qualification_gap_gets_real_preparation_guidance', () => {
    const req = requirement({ id: 'a', text: 'Owns a laptop', category: 'other', hardBlocking: false, factRef: { factId: 'laptop', category: 'other' } })
    const card = assess({ requirements: [req] }, { laptop: fact('no', 'other') })
    return card.readinessState === 'QUALIFICATION_GAP'
      && card.preparationMissions.length === 1
      && card.preparationChecklist.length > 0
      && card.recommendedNextAction.toLowerCase().includes('qualification gap')
      || `state=${card.readinessState} missions=${card.preparationMissions.length} checklist=${JSON.stringify(card.preparationChecklist)} nextAction=${card.recommendedNextAction}`
  })

  add('opre_26_blocked_gets_truthful_next_action', () => {
    const req = requirement({ id: 'a', text: 'basic req', category: 'other', factRef: { factId: 'basic', category: 'other' } })
    const card = assess({ requirements: [req], deadline: '2020-01-01T00:00:00Z' }, { basic: fact('yes', 'other') })
    return card.readinessState === 'BLOCKED'
      && card.recommendedNextAction.toLowerCase().includes('no longer actionable')
      && !card.recommendedNextAction.toLowerCase().includes('preparation checklist')
      || `nextAction=${card.recommendedNextAction}`
  })

  add('opre_27_deferred_gets_truthful_next_action', () => {
    const req = requirement({ id: 'a', text: 'CPR cert', category: 'certification', factRef: null })
    const card = assess({ requirements: [req] }, {}, 'defer')
    return card.readinessState === 'DEFERRED'
      && card.recommendedNextAction.toLowerCase().includes('deferred')
      && !card.recommendedNextAction.toLowerCase().includes('preparation checklist')
      || `nextAction=${card.recommendedNextAction}`
  })

  add('opre_28_hard_blocker_next_action_unaffected_by_other_fixes', () => {
    const req = requirement({ id: 'a', text: 'Must be 21+', category: 'age', factRef: { factId: 'age21', category: 'age' } })
    const card = assess({ requirements: [req] }, { age21: fact('no', 'age') })
    return card.recommendedNextAction.toLowerCase().includes('do not pursue') || `nextAction=${card.recommendedNextAction}`
  })

  // ---------------------------------------------------------------------
  // MEDIUM 4 — empty requirements
  // ---------------------------------------------------------------------
  add('opre_29_unresearched_empty_requirements_not_ready_now', () => {
    const card = assess({ requirements: [], requirementsResearched: false })
    return card.readinessState === 'ELIGIBILITY_UNCONFIRMED' || `state=${card.readinessState}`
  })

  add('opre_29b_undeclared_requirementsResearched_defaults_conservative', () => {
    const opp = opportunity({ requirements: [] })
    delete (opp as Partial<NormalizedOpportunityInput>).requirementsResearched
    const card = assessOpportunityReadiness({ opportunity: opp, commanderFacts: {} })
    return card.readinessState === 'ELIGIBILITY_UNCONFIRMED' || `state=${card.readinessState}`
  })

  add('opre_30_explicitly_verified_empty_requirements_is_ready_now', () => {
    const card = assess({ requirements: [], requirementsResearched: true })
    return card.readinessState === 'READY_NOW' || `state=${card.readinessState}`
  })

  // ---------------------------------------------------------------------
  // MEDIUM 5 — duplicate requirement IDs rejected at the boundary
  // ---------------------------------------------------------------------
  add('opre_31_duplicate_requirement_ids_rejected', () => {
    const dup = [requirement({ id: 'dup', text: 'A' }), requirement({ id: 'dup', text: 'B' })]
    const result = validateRequirementArray(dup)
    return !result.ok && result.reason.includes('duplicate') || `result=${JSON.stringify(result)}`
  })

  // ---------------------------------------------------------------------
  // MEDIUM 6 — input bounds
  // ---------------------------------------------------------------------
  add('opre_32_oversized_requirements_array_rejected', () => {
    const many = Array.from({ length: 201 }, (_, i) => requirement({ id: `r${i}`, text: `req ${i}`, factRef: null }))
    const result = validateRequirementArray(many)
    return !result.ok && result.reason.includes('maximum') || `result=${JSON.stringify(result)}`
  })

  add('opre_33_oversized_commanderFacts_rejected', () => {
    const many: CommanderFacts = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, fact('yes', 'other')]))
    const result = validateCommanderFacts(many)
    return !result.ok && result.reason.includes('maximum') || `result=${JSON.stringify(result)}`
  })

  add('opre_34_oversized_string_field_rejected', () => {
    const opp = opportunity({ title: 'x'.repeat(600) })
    const result = validateNormalizedOpportunityInput(opp)
    return !result.ok && result.reason.includes('title') || `result=${JSON.stringify(result)}`
  })

  add('opre_35_recurring_gap_log_dedupes_repeated_assessment', () => {
    __resetDevelopmentGapLog()
    const req = requirement({ id: 'r-fiber', text: 'Fiber construction fundamentals', category: 'training', factRef: null })
    const oppIds = ['o1', 'o2', 'o3']
    // Assess each opportunity TWICE — a naive unbounded log would double-count.
    for (const oppId of [...oppIds, ...oppIds]) {
      const matched = matchRequirements([req], {})
      recordGapObservations(oppId, matched, 30, 'USD')
    }
    const gaps = detectRecurringGaps()
    const found = gaps.find(g => g.skill === 'Fiber construction fundamentals')
    return Boolean(found) && found!.observedOpportunityCount === 3 || `gap=${JSON.stringify(found)}`
  })

  add('opre_35b_recurring_gaps_never_carry_a_value_under_unknown_compensation_basis', () => {
    // Regression for a third-review finding: assessOpportunityReadiness used
    // to pass the RAW, unsanitized opportunity.compensation into
    // recordGapObservations instead of the sanitized financial.compensation,
    // so an UNKNOWN-basis amount could surface as a concrete number via
    // recurringDevelopmentGaps.compensationRangeObserved on the API response.
    __resetDevelopmentGapLog()
    const req = requirement({ id: 'r-gap', text: 'Recurring gap skill', category: 'training', factRef: null })
    for (const oppId of ['g1', 'g2', 'g3']) {
      assess({ id: oppId, requirements: [req], compensation: { amount: 999999, currency: 'USD', basis: 'UNKNOWN', per: 'hour' } })
    }
    const gaps = detectRecurringGaps()
    const found = gaps.find(g => g.skill === 'Recurring gap skill')
    return Boolean(found) && found!.compensationRangeObserved.min === null && found!.compensationRangeObserved.max === null
      || `gap=${JSON.stringify(found)}`
  })

  // ---------------------------------------------------------------------
  // LOW — Commander question batching
  // ---------------------------------------------------------------------
  add('opre_36_identical_unresolved_requirements_produce_one_question', () => {
    const reqA = requirement({ id: 'a', text: 'Must pass phone screen', category: 'other', factRef: null })
    const reqB = requirement({ id: 'b', text: 'Must pass phone screen', category: 'other', factRef: null })
    const results = matchRequirements([reqA, reqB], {})
    const questions = buildCommanderQuestions(results)
    return questions.length === 1 && questions[0].resolvesRequirementIds.length === 2 || `questions=${JSON.stringify(questions)}`
  })

  add('opre_37_distinct_unresolved_requirements_not_collapsed', () => {
    const reqA = requirement({ id: 'a', text: 'Must pass phone screen', category: 'other', factRef: null })
    const reqB = requirement({ id: 'b', text: 'Must pass background review', category: 'other', factRef: null })
    const results = matchRequirements([reqA, reqB], {})
    const questions = buildCommanderQuestions(results)
    return questions.length === 2 || `questions=${JSON.stringify(questions.map(q => q.question))}`
  })

  add('opre_38_ambiguous_factref_reuse_not_collapsed_into_one_question', () => {
    const reqA = requirement({ id: 'a', text: 'Requirement one', category: 'other', factRef: { factId: 'shared3', category: 'other' } })
    const reqB = requirement({ id: 'b', text: 'Requirement two (different)', category: 'other', factRef: { factId: 'shared3', category: 'other' } })
    const results = matchRequirements([reqA, reqB], {})
    const questions = buildCommanderQuestions(results)
    return questions.length === 2 || `ambiguous factRef reuse was incorrectly collapsed: ${JSON.stringify(questions.map(q => q.question))}`
  })

  // ---------------------------------------------------------------------
  // Preparation missions — real gaps, no fabricated completion, hard blockers excluded
  // ---------------------------------------------------------------------
  add('opre_39_preparation_missions_correspond_to_real_gaps', () => {
    const req = requirement({ id: 'r-a', text: 'CPR certification', category: 'certification', factRef: null })
    const results = matchRequirements([req], {})
    const missions = buildPreparationMissions(results, 'opp-x')
    return missions.length === 1 && missions[0].gapAddressed === 'CPR certification' || 'mission did not correspond to gap'
  })

  add('opre_40_preparation_missions_do_not_claim_completion', () => {
    const req = requirement({ id: 'r-b', text: 'Forklift certification', category: 'certification', factRef: null })
    const results = matchRequirements([req], {})
    const missions = buildPreparationMissions(results, 'opp-x')
    return missions[0].completionEvidence.toLowerCase().includes('not yet completed') || 'mission implied completion'
  })

  add('opre_40b_hard_blocked_requirement_excluded_from_missions', () => {
    const hard = requirement({ id: 'r-hard', text: 'Must be authorized to work in the US', category: 'work_authorization', factRef: { factId: 'wa', category: 'work_authorization' } })
    const results = matchRequirements([hard], { wa: fact('no', 'work_authorization') })
    const missions = buildPreparationMissions(results, 'opp-x', new Set(['r-hard']))
    return missions.length === 0 || 'a hard blocker was disguised as a preparation mission'
  })

  // ---------------------------------------------------------------------
  // Evidence / machine-readability / opportunity-type generality (retained)
  // ---------------------------------------------------------------------
  add('opre_41_evidence_source_references_survive_assessment', () => {
    const card = assess({}, { 'driver_license.valid': fact('yes', 'license') })
    return card.evidenceSourceReferences.length > 0 && card.evidenceSourceReferences.some(ref => ref.includes('source:')) || 'evidence references missing'
  })

  add('opre_42_opportunity_types_remain_general', () => {
    const types = ['paid_survey', 'mystery_shopping', 'apprenticeship', 'government_opportunity', 'some_new_category_not_in_union']
    return types.every(type => assess({ opportunityType: type }).opportunityType === type) || 'engine special-cased an opportunity type instead of remaining general'
  })

  add('opre_43_readiness_results_machine_readable', () => {
    const card = assess({}, { 'driver_license.valid': fact('yes', 'license') })
    const roundTripped = JSON.parse(JSON.stringify(card))
    return roundTripped.readinessState === card.readinessState && roundTripped.opportunityName === card.opportunityName || 'card did not survive JSON round-trip'
  })

  // ---------------------------------------------------------------------
  // Source-level isolation / no-side-effect checks (explicit about their limits)
  // ---------------------------------------------------------------------
  add('opre_44_no_network_call_in_engine_or_route', () => {
    const engineSrc = source('lib/opportunity-readiness/readinessEngine.ts') + source('app/api/opportunity-readiness/assess/route.ts')
    return !/fetch\(|axios\.|XMLHttpRequest/.test(engineSrc) || 'network call found in readiness engine or API route'
  })

  add('opre_45_no_income_loot_reference_in_new_surface', () => {
    const files = [
      'app/api/opportunity-readiness/assess/route.ts',
      'lib/opportunity-readiness/readinessEngine.ts',
      'lib/opportunity-readiness/adapters.ts',
    ].map(source).join('\n')
    return !files.includes('income-loot') && !files.includes('income_loot') || 'new surface references income-loot'
  })

  add('opre_46_no_secret_values_exposed', () => {
    const engineSrc = source('lib/opportunity-readiness/readinessEngine.ts') + source('app/api/opportunity-readiness/assess/route.ts')
    return !engineSrc.includes('process.env.') || 'route or engine reads process.env directly'
  })

  add('opre_47_no_arbitrary_ownership_field_trusted', () => {
    const routeSrc = source('app/api/opportunity-readiness/assess/route.ts')
    return !/body\.(ownerUserId|userId|commanderId)/.test(routeSrc) || 'route trusts a client-supplied ownership field'
  })

  add('opre_48_no_durable_memory_write_path', () => {
    const card = assess({}, { 'driver_license.valid': fact('yes', 'license') })
    const engineSrc = source('lib/opportunity-readiness/readinessEngine.ts') + source('lib/opportunity-readiness/developmentGapDetector.ts')
    return card.durableMemoryWritten === false && !/supabase|\.insert\(|\.upsert\(/i.test(engineSrc) || 'durable memory write path detected'
  })

  add('opre_49_no_phase49g_protected_file_overlap', () => {
    const protectedFiles = [
      'app/api/income-loot/operations/route.ts',
      'app/income-loot/page.tsx',
      'components/war-room/income-loot/IncomeLootConsole.tsx',
      'lib/income-loot/consoleViewModel.ts',
      'lib/income-loot/operatingFund.ts',
      'lib/income-loot/operationalPolicy.ts',
      'lib/income-loot/operationsStore.ts',
      'lib/income-loot/participantAutomation.ts',
      'lib/income-loot/phase49g.validation.ts',
      'scripts/run-phase49-g-validation.mjs',
    ]
    for (const path of protectedFiles) {
      const full = join(process.cwd(), path)
      if (!existsSync(full)) continue
      const content = readFileSync(full, 'utf8')
      if (content.includes('opportunity-readiness')) return `${path} references opportunity-readiness — overlap risk`
    }
    return true
  })

  return results
}

/**
 * Genuine behavioral tests that exercise real functions with real inputs
 * rather than searching source text. `opre_50` actually imports and invokes
 * the exported POST handler with a constructed Request — no mock — proving
 * at runtime (not by inspection) that an unauthenticated/unconfigured caller
 * can never reach a card. It cannot also prove the authenticated-success
 * path, because that requires a real Commander session (Supabase-backed) —
 * this repo has no test framework or mocking infrastructure to fake one
 * without changing the shared auth module used by every other route. That
 * path is instead proven by `opre_51`/`opre_52` against the pure request
 * validator + engine directly, which is the part that changed in this pass.
 */
export async function runOpportunityReadinessAsyncValidation(): Promise<OpportunityReadinessValidationResult[]> {
  const results: OpportunityReadinessValidationResult[] = []

  results.push(await asyncTest('opre_50_real_post_rejects_without_commander_session', async () => {
    const routeUrl = pathToFileURL(resolve(process.cwd(), 'app/api/opportunity-readiness/assess/route.ts')).href
    const mod = await import(routeUrl) as { POST: (req: Request) => Promise<Response> }
    const req = new Request('http://localhost/api/opportunity-readiness/assess', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opportunity: opportunity() }),
    })
    const res = await mod.POST(req)
    const json = await res.json() as Record<string, unknown>
    return (res.status === 401 || res.status === 403 || res.status === 503) && !('card' in json)
      || `status=${res.status} body=${JSON.stringify(json)}`
  }))

  results.push(test('opre_51_parseAssessRequestBody_rejects_malformed_shape', () => {
    const malformed = { opportunity: { id: 'x' } } // missing every other required field
    const result = parseAssessRequestBody(malformed)
    return !result.ok && result.status === 400 && result.message.length > 0 || `result=${JSON.stringify(result)}`
  }))

  results.push(test('opre_51b_parseAssessRequestBody_rejects_missing_input', () => {
    const result = parseAssessRequestBody({})
    return !result.ok && result.status === 400 || `result=${JSON.stringify(result)}`
  }))

  results.push(test('opre_51c_parseAssessRequestBody_rejects_non_object_body', () => {
    const result = parseAssessRequestBody('not an object')
    return !result.ok && result.status === 400 || `result=${JSON.stringify(result)}`
  }))

  results.push(test('opre_52_parseAssessRequestBody_accepts_valid_request_and_pipeline_succeeds', () => {
    const body = { opportunity: opportunity(), commanderFacts: { 'driver_license.valid': fact('yes', 'license') } }
    const parsed = parseAssessRequestBody(body)
    if (!parsed.ok) return `expected ok, got ${JSON.stringify(parsed)}`
    const card = assessOpportunityReadiness({ opportunity: parsed.value.opportunity!, commanderFacts: parsed.value.commanderFacts, commanderDecision: parsed.value.commanderDecision })
    return card.readinessState === 'READY_NOW' || `state=${card.readinessState}`
  }))

  return results
}

if (process.argv[1]?.endsWith('validation.ts')) {
  const syncResults = runOpportunityReadinessValidation()
  const asyncResults = await runOpportunityReadinessAsyncValidation()
  const results = [...syncResults, ...asyncResults]
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Commander Qualification & Readiness Engine validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
