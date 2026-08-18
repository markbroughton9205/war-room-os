/**
 * Phase 49-I — Commander Opportunity Mission Bridge core types.
 *
 * This module is a thin integration layer only. It does not define a new
 * opportunity, a new readiness engine, or a new payment system — it composes:
 *  - lib/income-loot (EARN NOW opportunity identity — Phase 49-G/49-H)
 *  - lib/opportunity-readiness (Commander Qualification & Readiness Engine — Phase 49-D)
 * into a session-scoped mission progression: readiness -> preparation ->
 * field brief -> report-back -> (read-only) payment linkage.
 *
 * Truth rules baked into these types:
 * - planning != execution, ready != completed, completed != paid,
 *   promised pay != received pay, received pay != verified deposit,
 *   points != cash, estimated compensation != confirmed compensation.
 * - `missionStatus` only ever advances via an explicit Commander action
 *   (see bridgeEngine.ts `applyMissionAction`) or via reading already-verified
 *   evidence (the reward ledger). Nothing in this module infers Commander
 *   facts, executes an external action, or writes durable memory.
 */

export const MISSION_STATUSES = [
  'NOT_ASSESSED',
  'ASSESSING',
  'NOT_READY',
  'PREPARATION_REQUIRED',
  'READY_FOR_COMMANDER_ACTION',
  'COMMANDER_ACTIVE',
  'REPORT_BACK_DUE',
  'OUTCOME_REPORTED',
  'PAYMENT_PENDING',
  'PAYMENT_VERIFIED',
  'CLOSED',
  'DEFERRED',
  'BLOCKED',
] as const
export type MissionStatus = (typeof MISSION_STATUSES)[number]

/**
 * States from which a Commander may explicitly close a mission. This is the
 * single source of truth for CLOSE-eligibility — enforced identically by the
 * state machine (bridgeEngine.ts `applyMissionAction`) and the UI
 * (MissionBridgePanel.tsx). The UI must never rely on merely hiding the
 * Close button as its only protection; a direct API call is gated by this
 * same allow-list. NOT_ASSESSED, ASSESSING, PREPARATION_REQUIRED,
 * READY_FOR_COMMANDER_ACTION, COMMANDER_ACTIVE, and REPORT_BACK_DUE are
 * intentionally excluded — a mission in active planning/execution cannot be
 * closed out from under the Commander without first reaching an outcome,
 * payment, or blocked/deferred/not-ready resting state.
 */
export const CLOSABLE_MISSION_STATUSES: readonly MissionStatus[] = [
  'OUTCOME_REPORTED',
  'PAYMENT_PENDING',
  'PAYMENT_VERIFIED',
  'BLOCKED',
  'DEFERRED',
  'NOT_READY',
]

export const FIELD_BRIEF_AVAILABILITY = ['NOT_AVAILABLE', 'PREPARATION_BRIEF', 'FULL_FIELD_BRIEF'] as const
export type FieldBriefAvailability = (typeof FIELD_BRIEF_AVAILABILITY)[number]

/** Bounds enforced at the API boundary (app/api/opportunity-mission-bridge/route.ts). */
export const BRIDGE_INPUT_LIMITS = {
  MAX_ID_LENGTH: 200,
  MAX_TEXT_LENGTH: 2000,
  MAX_NOTES_LENGTH: 5000,
  MAX_LIST_ENTRIES: 100,
} as const

import type {
  CommanderQuestion,
  CompensationInput,
  ConfirmationBasis,
  MoneyEstimate,
  NumberEstimate,
  OpportunityType,
  ProviderQuestion,
  ReadinessState,
} from '@/lib/opportunity-readiness/types'

export type CommanderFieldBrief = {
  opportunityId: string
  opportunityTitle: string
  provider: string | null
  opportunityType: OpportunityType
  readinessState: ReadinessState
  missionStatus: MissionStatus
  location: string | null
  modality: 'remote' | 'in_person' | 'hybrid' | 'unknown'
  dateTimeWindow: string | null
  deadline: string | null
  compensation: MoneyEstimate
  compensationBasis: ConfirmationBasis
  expectedTimeCommitment: NumberEstimate
  effectiveHourlyEstimate: MoneyEstimate
  requiredDocuments: string[]
  requiredCredentials: string[]
  requiredEquipment: string[]
  preparationChecklist: string[]
  providerQuestions: ProviderQuestion[]
  commanderQuestions: CommanderQuestion[]
  travelNotes: string[]
  whatToBring: string[]
  whatToExpect: string
  whatToAsk: string[]
  successCheckpoint: string
  reportBackInstructions: string
  /** Every unresolved question that must be answered before this brief can be
   * upgraded — mirrors commanderQuestions text so the gap is explicit rather
   * than silently absent. */
  unresolvedQuestions: string[]
  evidenceRefs: string[]
  generatedAt: string
  externalActionsExecuted: false
  durableMemoryWritten: false
}

export type CommanderFieldBriefResult = {
  available: FieldBriefAvailability
  brief: CommanderFieldBrief | null
  unavailableReason: string | null
}

export const REPORT_BACK_OUTCOMES = ['NOT_REPORTED', 'DID_NOT_ATTEND', 'ATTENDED_NOT_COMPLETED', 'COMPLETED'] as const
export type ReportBackOutcome = (typeof REPORT_BACK_OUTCOMES)[number]

/** Commander self-report of payment status. Never conflated with ledger
 * verification — see PAYMENT_VERIFIED gating in bridgeEngine.ts, which only
 * ever comes from reading lib/income-loot reward ledger CASH_RECEIVED entries. */
export const REPORT_BACK_PAYMENT_STATUSES = ['NOT_APPLICABLE', 'NOT_YET_PAID', 'PROMISED', 'COMMANDER_REPORTED_RECEIVED_UNVERIFIED'] as const
export type ReportBackPaymentStatus = (typeof REPORT_BACK_PAYMENT_STATUSES)[number]

export type ReportBackInput = {
  opportunityId: string
  outcome: ReportBackOutcome
  providerResponse: string | null
  timeSpentMinutes: number | null
  travelCost: number | null
  otherCosts: number | null
  compensationPromised: CompensationInput | null
  /** Commander's own claim of what they received — self-reported, unverified. */
  compensationReceivedClaim: CompensationInput | null
  paymentStatus: ReportBackPaymentStatus
  evidenceRefs: string[]
  commanderNotes: string | null
}

export type ReportBackRecord = ReportBackInput & {
  ownerUserId: string
  missionStatusAtReport: MissionStatus
  reportedAt: string
  externalActionsExecuted: false
  durableMemoryWritten: false
}

/** The bridge's own session-scoped record of one Commander/opportunity
 * mission thread. One record per (ownerUserId, opportunityId) — see store.ts. */
export type MissionRecord = {
  ownerUserId: string
  opportunityId: string
  missionStatus: MissionStatus
  readinessState: ReadinessState | null
  lastReadinessSnapshotAt: string | null
  reportBack: ReportBackRecord | null
  ledgerVerifiedAt: string | null
  createdAt: string
  updatedAt: string
  persistence: 'session_only'
  externalActionsExecuted: false
  durableMemoryWritten: false
}
