/**
 * Attaches one canonical FRK session when a Foundry mission starts,
 * and reloads that same session on resume.
 */
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import type { FoundryReasoningBrief } from './types'
import { attachCanonicalSession, bindPointerToMission, emptyPointer, refreshPointer, setLifecycle } from './attachment'
import { createFoundryReasoningSession, selectSessionStrategy } from './orchestrator'
import { loadCanonicalSession, saveCanonicalSession, saveMissionPointer } from './persistence'

export type ReasoningMissionHost = {
  missionId: string
  goal?: string
  userRequest?: string
  createdAt?: string
  reasoningSessionId?: string | null
  reasoningBrief?: FoundryReasoningBrief | null
  reasoningStatus?: string | null
  reasoningUpdatedAt?: string | null
}

export function defaultReasoningRoot(): string | null {
  if (process.env.FRK_REASONING_ROOT) return process.env.FRK_REASONING_ROOT
  try {
    const app = resolveLocalAppDataPaths()
    return path.join(app.data, 'foundry', 'reasoning-kernel')
  } catch {
    return null
  }
}

export async function ensureLiveMissionReasoning(
  mission: ReasoningMissionHost,
  event: 'START' | 'RESUME',
  root: string | null = defaultReasoningRoot(),
): Promise<{ ok: boolean; duplicateSession: boolean; status: string }> {
  if (!root) {
    mission.reasoningStatus = 'REASONING_STATE_UNTRUSTED'
    return { ok: false, duplicateSession: false, status: 'REASONING_STATE_UNTRUSTED' }
  }
  try {
    if (event === 'RESUME') return await resumeAttachedSession(mission, root)
    if (mission.reasoningSessionId) {
      return { ok: true, duplicateSession: false, status: mission.reasoningStatus ?? 'ATTACH' }
    }
    const session = createFoundryReasoningSession({
      missionId: mission.missionId,
      goal: mission.goal || mission.userRequest || mission.missionId,
      now: mission.createdAt,
    })
    selectSessionStrategy(session)
    setLifecycle(session, 'CREATE')
    const pointer = emptyPointer(mission.missionId)
    const attached = attachCanonicalSession(pointer, session)
    await saveCanonicalSession(root, session)
    await saveMissionPointer(root, pointer)
    bindPointerToMission(mission, pointer)
    return { ok: attached.ok, duplicateSession: attached.duplicateSession, status: pointer.reasoningStatus ?? 'ATTACH' }
  } catch {
    mission.reasoningStatus = 'REASONING_STATE_UNTRUSTED'
    return { ok: false, duplicateSession: false, status: 'REASONING_STATE_UNTRUSTED' }
  }
}

async function resumeAttachedSession(mission: ReasoningMissionHost, root: string): Promise<{ ok: boolean; duplicateSession: boolean; status: string }> {
  if (!mission.reasoningSessionId) {
    return { ok: true, duplicateSession: false, status: mission.reasoningStatus ?? 'UNATTACHED' }
  }
  try {
    const session = await loadCanonicalSession(root, mission.reasoningSessionId)
    if (session.missionId !== mission.missionId) {
      mission.reasoningStatus = 'REASONING_STATE_UNTRUSTED'
      return { ok: false, duplicateSession: false, status: 'REASONING_STATE_UNTRUSTED' }
    }
    setLifecycle(session, 'RESUME')
    const pointer = emptyPointer(mission.missionId)
    refreshPointer(pointer, session)
    await saveCanonicalSession(root, session)
    await saveMissionPointer(root, pointer)
    bindPointerToMission(mission, pointer)
    return { ok: true, duplicateSession: false, status: 'RESUME' }
  } catch {
    mission.reasoningStatus = 'REASONING_STATE_UNTRUSTED'
    return { ok: false, duplicateSession: false, status: 'REASONING_STATE_UNTRUSTED' }
  }
}
