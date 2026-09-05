/**
 * Derives a session's full, Commander-visible ProposalState — reusing native-builder's OWN repair
 * state as the source of truth for everything past "bridged" (mission brief: "Reuse Native
 * Builder's actual state where possible rather than duplicating truth"). Same one-state-maps-to-
 * one-status discipline as lib/mission-runtime/types.ts's missionStatusFromRepairState — this is a
 * pure lookup, never a second persisted copy of "what state is this repair really in."
 */
import type { NativeRepairState } from '@/lib/native-builder/types'
import type { EngineeringSession, ProposalState, StoredProposalState } from './types'

export function proposalStateFromRepairState(state: NativeRepairState): ProposalState {
  switch (state) {
    case 'detected':
    case 'collecting_evidence':
    case 'inspecting_repository':
    case 'planning':
      // The bridge only ever leaves a fresh repair at these states transiently mid-call; by the
      // time a caller can observe it, it has already reached awaiting_local_execution_approval or
      // been rejected before persisting. Mapped honestly rather than omitted.
      return 'BRIDGED'
    case 'awaiting_local_execution_approval':
      return 'AWAITING_APPROVAL'
    case 'applying_patch':
      return 'APPLIED'
    case 'validating':
      return 'VALIDATING'
    case 'verification_failed':
      return 'FAILED'
    case 'partially_verified':
    case 'awaiting_commander_review':
    case 'resolved':
      return 'VALID'
    case 'rolled_back':
      return 'ROLLED_BACK'
    case 'blocked':
    case 'escalation_recommended':
    case 'cancelled':
      return 'FAILED'
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

/** `repair` is whatever the caller fetched for `session.nativeBuilderRepairId` right now (or null
 * if there is none, or the fetch failed) — this function never fetches anything itself, keeping it
 * a pure, easily-tested projection. Falls back to the session's own stored pre-bridge state when
 * there is no repair to project from. */
export function deriveProposalState(session: Pick<EngineeringSession, 'proposalState'>, repairState: NativeRepairState | null): ProposalState {
  if (repairState) return proposalStateFromRepairState(repairState)
  return session.proposalState
}

export function isStoredProposalState(value: string): value is StoredProposalState {
  return (['NONE', 'GENERATING', 'INVALID', 'READY', 'BRIDGED'] as const).includes(value as StoredProposalState)
}
