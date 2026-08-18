/**
 * Phase 49-D — Commander Qualification & Readiness Engine core types.
 *
 * Truth rules baked into these types:
 * - Personal Commander facts (licenses, certifications, work authorization, age,
 *   transportation, equipment ownership, household/medical/demographic facts) are
 *   never inferred. They only enter an assessment when explicitly supplied per
 *   request via `CommanderFacts`. Nothing here reads or writes a durable
 *   Commander profile store.
 * - Every requirement result keeps its evidence source and confidence so a
 *   reviewer can see why a classification was reached.
 * - Compensation and time-commitment figures always carry a `basis` of
 *   CONFIRMED, ESTIMATED, or UNKNOWN — UNKNOWN is never coerced into a number.
 * - This module performs no external action and writes nothing durable.
 */

export const READINESS_STATES = [
  'READY_NOW',
  'READY_WITH_PREP',
  'QUALIFICATION_GAP',
  'DOCUMENTATION_NEEDED',
  'TRAINING_REQUIRED',
  'LOCATION_CONSTRAINT',
  'OPERATOR_INPUT_REQUIRED',
  'ELIGIBILITY_UNCONFIRMED',
  'NOT_CURRENTLY_ELIGIBLE',
  'DEFERRED',
  'BLOCKED',
] as const
export type ReadinessState = (typeof READINESS_STATES)[number]

export const REQUIREMENT_CLASSIFICATIONS = [
  'CONFIRMED_MET',
  'CONFIRMED_NOT_MET',
  'UNKNOWN',
  'COMMANDER_CONFIRMATION_REQUIRED',
  'DOCUMENT_REQUIRED',
  'TRAINING_REQUIRED',
  'CREDENTIAL_REQUIRED',
  'LOCATION_REQUIRED',
  'EQUIPMENT_REQUIRED',
  'DEADLINE_CONSTRAINT',
] as const
export type RequirementClassification = (typeof REQUIREMENT_CLASSIFICATIONS)[number]

/** Open string union — new requirement categories do not require touching this file. */
export type RequirementCategory =
  | 'license'
  | 'certification'
  | 'education'
  | 'background_check'
  | 'drug_test'
  | 'work_authorization'
  | 'age'
  | 'identity_document'
  | 'transportation'
  | 'equipment'
  | 'location'
  | 'schedule_availability'
  | 'skill'
  | 'training'
  | 'document'
  | 'deadline'
  | 'other'
  | (string & {})

/** Intrinsically hard-blocking categories — legal/eligibility facts, not
 * preparation gaps. A CONFIRMED_NOT_MET on one of these ALWAYS produces
 * NOT_CURRENTLY_ELIGIBLE. This list is explicit and reviewable; no caller
 * input (including `hardBlocking: false` on the requirement) can downgrade a
 * category on this list. A caller MAY elevate a category that is NOT on this
 * list to hard-blocking via `hardBlocking: true`, but may never demote one
 * that is. See requirementMatcher.ts `isHardBlocking`. */
export const HARD_BLOCK_CATEGORIES: readonly RequirementCategory[] = [
  'work_authorization',
  'age',
  'background_check',
  'drug_test',
]

/** Open string union — new opportunity types do not require touching this file. */
export type OpportunityType =
  | 'job'
  | 'apprenticeship'
  | 'trade'
  | 'paid_interview'
  | 'paid_focus_group'
  | 'paid_research_participation'
  | 'paid_survey'
  | 'product_testing'
  | 'app_website_testing'
  | 'store_scan'
  | 'mystery_shopping'
  | 'local_gig'
  | 'microtask'
  | 'contract'
  | 'government_opportunity'
  | 'training_to_employment'
  | 'rebate_reward'
  | 'other'
  | (string & {})

export const CONFIRMATION_BASES = ['CONFIRMED', 'ESTIMATED', 'UNKNOWN'] as const
export type ConfirmationBasis = (typeof CONFIRMATION_BASES)[number]

export type MoneyEstimate = {
  value: number | null
  currency: string
  basis: ConfirmationBasis
  notes: string | null
}

export type NumberEstimate = {
  value: number | null
  basis: ConfirmationBasis
  notes: string | null
}

export const COMPENSATION_PERIODS = ['hour', 'day', 'week', 'month', 'year', 'flat_total', 'per_task', 'points'] as const
export type CompensationPer = (typeof COMPENSATION_PERIODS)[number]

export type CompensationInput = {
  amount: number | null
  currency: string
  basis: ConfirmationBasis
  per: CompensationPer
  notes?: string | null
}

export type TimeCommitmentInput = {
  /** Hours per week, when the engagement is ongoing/hourly. */
  hoursPerWeek: number | null
  /** Total hours for a flat-fee/per-task engagement. */
  totalHoursEstimate: number | null
  basis: ConfirmationBasis
  /** Set by financialAnalysis.ts when an input value was invalid (negative or
   * non-finite) and had to be treated as unknown rather than fabricated. */
  notes?: string | null
}

export type KnownCostsInput = {
  travelCost: number | null
  equipmentCost: number | null
  fees: number | null
  currency: string
  basis: ConfirmationBasis
  /** Set by financialAnalysis.ts when an input value was invalid (negative or
   * non-finite) and had to be treated as unknown rather than fabricated. */
  notes?: string | null
}

/**
 * A structured reference to a Commander fact. Facts are scoped by BOTH
 * `factId` and `category` so a bare string collision alone can never let one
 * requirement silently consume the answer meant for an unrelated one — see
 * requirementMatcher.ts. Prefer a specific, canonical dotted `factId` (e.g.
 * 'driver_license.valid', 'credential.fiber_certification',
 * 'equipment.laptop', 'availability.weekend') over a generic one — this is an
 * open string, not a closed enum, so new facts never require touching this
 * file.
 */
export type FactReference = {
  factId: string
  category: RequirementCategory
  /** Explicit author assertion that this requirement intentionally shares its
   * fact with any other requirement using the identical factId+category, even
   * when the requirement text differs. Defaults to false — reuse across
   * differently-worded requirements is otherwise treated as ambiguous and
   * resolves to a safe unresolved classification rather than CONFIRMED_MET. */
  trustedShared?: boolean
}

export type RequirementInput = {
  id: string
  text: string
  category: RequirementCategory
  /** Structured reference into `CommanderFacts` used to resolve this
   * requirement. Leave null when the requirement is resolved from opportunity
   * data itself (e.g. a document or deadline) rather than a personal
   * Commander fact. */
  factRef: FactReference | null
  /** May only ELEVATE a non-intrinsic category to hard-blocking. Cannot
   * downgrade a category on HARD_BLOCK_CATEGORIES — see `isHardBlocking`. */
  hardBlocking?: boolean
}

export const COMMANDER_FACT_STATUSES = ['yes', 'no', 'unknown'] as const
export type CommanderFactStatus = (typeof COMMANDER_FACT_STATUSES)[number]

export type CommanderFactValue = {
  status: CommanderFactStatus
  /** Must match the `category` on the FactReference that looks this fact up —
   * this is the scoping mechanism that prevents a fact declared for one kind
   * of thing from silently answering a requirement of a different kind. */
  category: RequirementCategory
  detail?: string | null
}

/** Ephemeral, request-scoped Commander facts, keyed by `factId`. Never read
 * from or written to a durable profile store by this module — the caller
 * supplies what it already knows for this single assessment. */
export type CommanderFacts = Record<string, CommanderFactValue>

/** Input-size bounds enforced at the API boundary (app/api/opportunity-readiness/assess/route.ts).
 * Generous enough not to block real opportunities; bound worst-case payload processing. */
export const INPUT_LIMITS = {
  MAX_REQUIREMENTS: 200,
  MAX_COMMANDER_FACTS: 200,
  MAX_TITLE_LENGTH: 500,
  MAX_TEXT_LENGTH: 2000,
  MAX_ID_LENGTH: 200,
  MAX_CATEGORY_LENGTH: 100,
  MAX_NOTES_LENGTH: 5000,
  MAX_FIELD_LENGTH: 2000,
} as const

export type NormalizedOpportunityInput = {
  id: string
  title: string
  provider: string | null
  opportunityType: OpportunityType
  source: string | null
  sourceUrl: string | null
  location: string | null
  workMode: 'remote' | 'in_person' | 'hybrid' | 'unknown'
  compensation: CompensationInput
  timeCommitment: TimeCommitmentInput
  knownCosts?: KnownCostsInput | null
  requirements: RequirementInput[]
  /** True only when the caller has explicitly verified this opportunity truly
   * has no requirements (e.g. confirmed by reading the posting). Leave
   * false/undefined when requirements simply have not been researched yet —
   * an empty `requirements` array with this unset is treated as incomplete
   * data, not as a verified all-clear. See readinessEngine.ts. */
  requirementsResearched?: boolean
  deadline: string | null
  applicationWindow: string | null
  employmentClassification?: 'w2' | '1099' | 'stipend' | 'reward_points' | 'unknown'
  trainingPaid?: CommanderFactStatus
  equipmentProvided?: CommanderFactStatus
  scheduleFixed?: CommanderFactStatus
  paymentMethodKnown?: boolean
  notes?: string | null
}

export type RequirementResult = {
  requirementId: string
  requirementText: string
  /** Normalized (case/whitespace-folded) category — see requirementMatcher.ts normalizeCategory. */
  category: RequirementCategory
  classification: RequirementClassification
  evidenceSource: string
  confidence: number
  commanderInputNeeded: boolean
  explanation: string
  nextAction: string
  /** `${category}::${factId}` when this requirement used a FactReference, else
   * null. Used to group requirements that share the identical underlying fact
   * into a single Commander question rather than asking twice. */
  factGroupKey: string | null
}

export type FinancialAnalysisResult = {
  compensation: CompensationInput
  hourlyEquivalent: MoneyEstimate
  dailyEquivalent: MoneyEstimate
  weeklyEquivalent: MoneyEstimate
  monthlyEquivalent: MoneyEstimate
  annualizedEquivalent: MoneyEstimate
  grossOpportunityValue: MoneyEstimate
  knownCosts: MoneyEstimate
  expectedNetValue: MoneyEstimate
  estimatedTotalTimeCommitmentHours: NumberEstimate
  effectiveHourlyReturn: MoneyEstimate
}

export type CommanderQuestion = {
  id: string
  requirementId: string | null
  question: string
  whyItMatters: string
  resolvesRequirement: string
  /** Every requirement ID this single question resolves — more than one entry
   * only when requirements shared the identical underlying fact (see
   * RequirementResult.factGroupKey or identical requirement text). */
  resolvesRequirementIds: string[]
  possibleReadinessStateChange: string
}

export type ProviderQuestion = {
  id: string
  question: string
  fieldMissing: string
}

export type PreparationMission = {
  id: string
  title: string
  reason: string
  gapAddressed: string
  expectedResult: string
  requiredSteps: string[]
  estimatedEffort: string
  dependency: string | null
  completionEvidence: string
  opportunityIdsUnlocked: string[]
}

export type RecurringDevelopmentGap = {
  skill: string
  observedOpportunityCount: number
  observedOpportunityIds: string[]
  compensationRangeObserved: { min: number | null; max: number | null; currency: string | null }
  commonMissingRequirement: string
  suggestedDevelopmentMission: string
}

export type FieldBriefFacts = {
  whereToGo: string | null
  when: string | null
  whatToBring: string[]
  whatToExpect: string | null
  whatToAsk: string[]
  expectedIncome: MoneyEstimate
  expectedTime: NumberEstimate
  successCheckpoint: string
} | null

export type CommanderReadinessCard = {
  opportunityName: string
  providerEmployer: string | null
  opportunityType: OpportunityType
  source: string | null
  location: string | null
  workMode: 'remote' | 'in_person' | 'hybrid' | 'unknown'
  compensation: MoneyEstimate
  compensationBasis: ConfirmationBasis
  estimatedTimeCommitment: NumberEstimate
  estimatedEffectiveHourlyValue: MoneyEstimate
  requiredQualifications: string[]
  confirmedMetQualifications: string[]
  confirmedMissingQualifications: string[]
  unknownRequirements: string[]
  commanderQuestions: CommanderQuestion[]
  requiredDocuments: string[]
  requiredCredentials: string[]
  requiredCertifications: string[]
  requiredSkills: string[]
  trainingGaps: string[]
  requiredEquipment: string[]
  travelLocationConstraints: string[]
  deadline: string | null
  applicationOrParticipationWindow: string | null
  risksBlockers: string[]
  providerQuestions: ProviderQuestion[]
  preparationChecklist: string[]
  recommendedNextAction: string
  readinessState: ReadinessState
  readinessScore: number | null
  evidenceSourceReferences: string[]
  estimatedVsConfirmedFinancialValues: FinancialAnalysisResult
  requirementResults: RequirementResult[]
  preparationMissions: PreparationMission[]
  fieldBriefFacts: FieldBriefFacts
  externalActionsExecuted: false
  durableMemoryWritten: false
  persistence: 'session_only'
}

export type AssessmentInput = {
  opportunity: NormalizedOpportunityInput
  commanderFacts?: CommanderFacts
  /** Optional explicit Commander override — does not change underlying
   * requirement analysis, only the final readiness state surfaced. */
  commanderDecision?: 'approve' | 'defer' | null
}
