/**
 * Mission attachment projects a brief and a reference.
 * The reasoning graph stays on the session object.
 */
import type { FoundryMissionRecord } from '../foundryMissionTypes'
import { explainSession } from './session'
import type { FoundryReasoningBrief, FoundryReasoningSession, FrkLifecycle } from './types'

export type MissionReasoningPointer = {
  missionId: string
  reasoningSessionId: string | null
  reasoningBrief: FoundryReasoningBrief | null
  reasoningStatus: string | null
  reasoningUpdatedAt: string | null
}

export function emptyPointer(missionId: string): MissionReasoningPointer {
  return {
    missionId,
    reasoningSessionId: null,
    reasoningBrief: null,
    reasoningStatus: null,
    reasoningUpdatedAt: null,
  }
}

export function projectPointer(session: FoundryReasoningSession): MissionReasoningPointer {
  return {
    missionId: session.missionId,
    reasoningSessionId: session.sessionId,
    reasoningBrief: explainSession(session),
    reasoningStatus: session.status === 'BLOCKED_PROVIDER' ? 'BLOCKED_PROVIDER' : session.search.lifecycle,
    reasoningUpdatedAt: session.updatedAt,
  }
}

export function pointerStoresGraph(pointer: MissionReasoningPointer): boolean {
  return Object.prototype.hasOwnProperty.call(pointer, 'reasoningGraph')
    || JSON.stringify(pointer).includes('"reasoningGraph"')
}

export function refreshPointer(pointer: MissionReasoningPointer, session: FoundryReasoningSession): MissionReasoningPointer {
  const next = projectPointer(session)
  pointer.reasoningSessionId = next.reasoningSessionId
  pointer.reasoningBrief = next.reasoningBrief
  pointer.reasoningStatus = next.reasoningStatus
  pointer.reasoningUpdatedAt = next.reasoningUpdatedAt
  return pointer
}

export function attachCanonicalSession(
  pointer: MissionReasoningPointer,
  session: FoundryReasoningSession,
): { ok: boolean; reason: string; duplicateSession: boolean } {
  if (pointer.reasoningSessionId && pointer.reasoningSessionId !== session.sessionId) {
    return { ok: false, reason: 'Mission already has one canonical reasoning session.', duplicateSession: false }
  }
  const already = pointer.reasoningSessionId === session.sessionId
  session.search.lifecycle = 'ATTACH'
  refreshPointer(pointer, session)
  return {
    ok: true,
    reason: already ? 'Canonical session already attached.' : 'Session attached.',
    duplicateSession: false,
  }
}

export function setLifecycle(session: FoundryReasoningSession, lifecycle: FrkLifecycle): void {
  session.search.lifecycle = lifecycle
}

export function bindPointerToMission(mission: FoundryMissionRecord, pointer: MissionReasoningPointer): void {
  mission.reasoningSessionId = pointer.reasoningSessionId
  mission.reasoningBrief = pointer.reasoningBrief
  mission.reasoningStatus = pointer.reasoningStatus
  mission.reasoningUpdatedAt = pointer.reasoningUpdatedAt
}
