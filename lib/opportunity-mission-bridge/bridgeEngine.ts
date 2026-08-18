import type { CommanderReadinessCard, ReadinessState } from '@/lib/opportunity-readiness/types'
import { CLOSABLE_MISSION_STATUSES, type MissionStatus } from './types'

/**
 * Pure derivation of a bridge MissionStatus from the existing Phase 49-D
 * readiness engine's output. This function makes no external call and reads
 * no store — it is a deterministic projection, safe to call from a route or
 * directly from a test.
 *
 * Readiness states that intrinsically carry a preparation path (documents,
 * training, location, equipment/credentials, or a qualification gap that has
 * at least one generated preparation mission) map to PREPARATION_REQUIRED.
 * Readiness states that still require more information before any
 * preparation plan can even be formed map to NOT_READY. Hard blockers and
 * deadline lockouts map to BLOCKED; an explicit Commander defer maps to
 * DEFERRED. Only READY_NOW ever reaches READY_FOR_COMMANDER_ACTION.
 */
export function deriveMissionStatusFromReadiness(input: { readinessState: ReadinessState; hasPreparationPath: boolean }): MissionStatus {
  const state = input.readinessState
  if (state === 'DEFERRED') return 'DEFERRED'
  if (state === 'BLOCKED' || state === 'NOT_CURRENTLY_ELIGIBLE') return 'BLOCKED'
  if (state === 'READY_NOW') return 'READY_FOR_COMMANDER_ACTION'
  if (state === 'READY_WITH_PREP' || state === 'DOCUMENTATION_NEEDED' || state === 'TRAINING_REQUIRED' || state === 'LOCATION_CONSTRAINT') {
    return 'PREPARATION_REQUIRED'
  }
  if (state === 'QUALIFICATION_GAP') {
    return input.hasPreparationPath ? 'PREPARATION_REQUIRED' : 'NOT_READY'
  }
  // OPERATOR_INPUT_REQUIRED, ELIGIBILITY_UNCONFIRMED, and any future addition
  // to ReadinessState default to the conservative "not enough is known yet"
  // bucket rather than silently implying readiness.
  return 'NOT_READY'
}

/** Convenience overload for callers holding a full readiness card. */
export function deriveMissionStatusFromReadinessCard(card: Pick<CommanderReadinessCard, 'readinessState' | 'preparationMissions'>): MissionStatus {
  return deriveMissionStatusFromReadiness({ readinessState: card.readinessState, hasPreparationPath: card.preparationMissions.length > 0 })
}

export type MissionAction =
  | { type: 'SYNC_ASSESSMENT'; readinessState: ReadinessState; hasPreparationPath: boolean }
  | { type: 'COMMANDER_MARK_ACTIVE' }
  | { type: 'COMMANDER_REPORT_BACK' }
  | { type: 'LEDGER_PAYMENT_VERIFIED' }
  | { type: 'COMMANDER_CLOSE' }

export type MissionTransitionResult =
  | { ok: true; status: MissionStatus }
  | { ok: false; reason: string }

const READINESS_DERIVED_STATUSES: readonly MissionStatus[] = [
  'NOT_READY',
  'PREPARATION_REQUIRED',
  'READY_FOR_COMMANDER_ACTION',
  'DEFERRED',
  'BLOCKED',
]

/**
 * The only place mission status is allowed to change. Every transition here
 * requires either (a) a fresh readiness assessment result the caller already
 * obtained from the existing /api/opportunity-readiness/assess route, or (b)
 * an explicit Commander-initiated action. There is no path from NOT_ASSESSED
 * straight to COMMANDER_ACTIVE, and no path to PAYMENT_VERIFIED except
 * LEDGER_PAYMENT_VERIFIED, which callers may only invoke after reading a real
 * CASH_RECEIVED reward-ledger entry (see reportBack.ts `checkLedgerVerifiedPayment`).
 */
export function applyMissionAction(current: MissionStatus, action: MissionAction): MissionTransitionResult {
  switch (action.type) {
    case 'SYNC_ASSESSMENT': {
      // Re-deriving from readiness is always allowed except once a mission
      // has moved into report-back/payment territory or been closed — at
      // that point a stale re-assessment must not silently roll back
      // Commander-reported progress.
      if (current === 'COMMANDER_ACTIVE' || current === 'REPORT_BACK_DUE' || current === 'OUTCOME_REPORTED' || current === 'PAYMENT_PENDING' || current === 'PAYMENT_VERIFIED' || current === 'CLOSED') {
        return { ok: false, reason: `Cannot re-sync readiness once mission status is ${current}. Report back or reopen the mission first.` }
      }
      const derived = deriveMissionStatusFromReadiness({ readinessState: action.readinessState, hasPreparationPath: action.hasPreparationPath })
      return { ok: true, status: derived }
    }
    case 'COMMANDER_MARK_ACTIVE': {
      if (current !== 'READY_FOR_COMMANDER_ACTION') {
        return { ok: false, reason: `Mission must be READY_FOR_COMMANDER_ACTION before the Commander can mark it active (current: ${current}).` }
      }
      return { ok: true, status: 'COMMANDER_ACTIVE' }
    }
    case 'COMMANDER_REPORT_BACK': {
      if (current !== 'COMMANDER_ACTIVE' && current !== 'REPORT_BACK_DUE') {
        return { ok: false, reason: `A report-back requires the mission to be COMMANDER_ACTIVE or REPORT_BACK_DUE (current: ${current}).` }
      }
      return { ok: true, status: 'OUTCOME_REPORTED' }
    }
    case 'LEDGER_PAYMENT_VERIFIED': {
      if (current !== 'OUTCOME_REPORTED' && current !== 'PAYMENT_PENDING') {
        return { ok: false, reason: `Payment can only be verified after an outcome has been reported (current: ${current}).` }
      }
      return { ok: true, status: 'PAYMENT_VERIFIED' }
    }
    case 'COMMANDER_CLOSE': {
      if (current === 'CLOSED') return { ok: false, reason: 'Mission is already closed.' }
      // Narrow allow-list, not "anything except CLOSED" — see
      // CLOSABLE_MISSION_STATUSES in types.ts. A mission still in planning
      // (NOT_ASSESSED/ASSESSING/PREPARATION_REQUIRED/READY_FOR_COMMANDER_ACTION)
      // or actively in the field (COMMANDER_ACTIVE/REPORT_BACK_DUE) cannot be
      // closed out from under the Commander; it must first reach an outcome,
      // payment, or a resting state (BLOCKED/DEFERRED/NOT_READY).
      if (!CLOSABLE_MISSION_STATUSES.includes(current)) {
        return { ok: false, reason: `Mission cannot be closed from status ${current}. Closable states: ${CLOSABLE_MISSION_STATUSES.join(', ')}.` }
      }
      return { ok: true, status: 'CLOSED' }
    }
    default: {
      const exhaustiveCheck: never = action
      return { ok: false, reason: `Unknown action: ${String(exhaustiveCheck)}` }
    }
  }
}

/** True only for the readiness-derived statuses a fresh assessment may
 * legally overwrite — used by callers deciding whether to call SYNC_ASSESSMENT. */
export function isReadinessDerivedStatus(status: MissionStatus): boolean {
  return READINESS_DERIVED_STATUSES.includes(status) || status === 'NOT_ASSESSED' || status === 'ASSESSING'
}
