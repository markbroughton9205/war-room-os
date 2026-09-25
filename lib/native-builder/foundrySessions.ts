/**
 * Persistent Foundry coding sessions — not Council chats.
 * Stored beside native-builder repairs under the authorized workspace.
 */
import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { foundryDataHierarchy } from './foundryPaths'
import { parseJsonRecovering, writeFileAtomic } from './foundryAtomicJson'
import { withRecordLock } from './foundryMissionOwnership'
import type { FoundryRole } from './foundryRoles'
import { isUntouchedEmptySession as sessionIsUntouchedEmpty } from './foundryCommanderShell'

export type FoundryChatMessage = {
  id: string
  at: string
  speaker: 'COMMANDER' | FoundryRole | 'SYSTEM'
  text: string
}

export type FoundrySessionRecord = {
  id: string
  title: string
  workspaceId?: string
  projectName?: string
  createdAt: string
  updatedAt: string
  missionIds: string[]
  activeMissionId?: string
  agents: FoundryRole[]
  chat: FoundryChatMessage[]
  activity: { at: string; role: string; detail: string }[]
  archived?: boolean
  archivedAt?: string
  archivedBy?: string
}

export const FOUNDRY_PROTECTED_MISSION_STATES = new Set([
  'QUEUED',
  'UNDERSTANDING',
  'INSPECTING',
  'PLANNING',
  'EXECUTING',
  'VALIDATING',
  'BUILDING',
  'PACKAGING',
  'INSTALLING',
  'VERIFYING',
  'REPLANNING',
  'PAUSED',
  'WAITING_AUTHORIZATION',
  'WAITING_RESOURCE',
  'ACTIVATION_PENDING',
  'RECOVERING',
])

export const FOUNDRY_MUTATING_MISSION_STATES = FOUNDRY_PROTECTED_MISSION_STATES

function sessionsDir(): string {
  const env = process.env.FOUNDRY_SESSIONS_DIR?.trim()
  if (env) return path.resolve(env)
  return foundryDataHierarchy().sessions
}

function legacySessionsDir(): string | null {
  if (process.env.FOUNDRY_SESSIONS_DIR?.trim()) return null
  return path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'foundry-sessions')
}

function sessionSearchDirs(): string[] {
  const dirs = [sessionsDir()]
  const legacy = legacySessionsDir()
  if (legacy && legacy !== dirs[0]) dirs.push(legacy)
  return dirs
}

function isSession(v: unknown): v is FoundrySessionRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.title === 'string' && Array.isArray(o.chat) && Array.isArray(o.missionIds)
}

export type ListFoundrySessionsOptions = {
  includeArchived?: boolean
  archivedOnly?: boolean
}

export async function listFoundrySessions(
  workspaceId?: string,
  options?: ListFoundrySessionsOptions,
): Promise<FoundrySessionRecord[]> {
  const seen = new Set<string>()
  const out: FoundrySessionRecord[] = []
  for (const dir of sessionSearchDirs()) {
    let names: string[]
    try {
      names = (await readdir(dir)).filter(n => n.endsWith('.json'))
    } catch {
      continue
    }
    for (const name of names) {
      try {
        const read = parseJsonRecovering(await readFile(path.join(dir, name), 'utf8'))
        const parsed = read.ok ? read.value : null
        if (!isSession(parsed) || seen.has(parsed.id)) continue
        if (workspaceId && parsed.workspaceId !== workspaceId) continue
        const archived = parsed.archived === true
        if (options?.archivedOnly) {
          if (!archived) continue
        } else if (!options?.includeArchived && archived) {
          continue
        }
        seen.add(parsed.id)
        out.push(parsed)
      } catch {
        /* skip corrupt */
      }
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getFoundrySession(id: string): Promise<FoundrySessionRecord | null> {
  for (const dir of sessionSearchDirs()) {
    try {
      // A conversation file torn by the old non-atomic writer still holds one complete record; use it rather than lose the messages.
      const read = parseJsonRecovering(await readFile(path.join(dir, `${id}.json`), 'utf8'))
      if (read.ok && isSession(read.value)) return read.value
    } catch {
      /* try next */
    }
  }
  return null
}

export async function saveFoundrySession(session: FoundrySessionRecord): Promise<FoundrySessionRecord> {
  const dir = sessionsDir()
  await mkdir(dir, { recursive: true })
  const next = { ...session, updatedAt: new Date().toISOString() }
  const body = JSON.stringify(next, null, 2)
  await writeFileAtomic(path.join(dir, `${session.id}.json`), body)
  const legacy = legacySessionsDir()
  if (legacy && legacy !== dir) {
    try {
      await mkdir(legacy, { recursive: true })
      await writeFileAtomic(path.join(legacy, `${session.id}.json`), body)
    } catch {
      /* installed UI can still read canonical app-data */
    }
  }
  return next
}

export async function recoverStaleSessionMissionPointers(): Promise<number> {
  const { loadMission } = await import('./foundryMissionStore')
  const { isActiveCommanderMission } = await import('./foundryCommanderExperience')
  const sessions = await listFoundrySessions(undefined, { includeArchived: true })
  let cleared = 0
  for (const session of sessions) {
    if (!session.activeMissionId) continue
    const mission = await loadMission(session.activeMissionId)
    if (mission && isActiveCommanderMission(mission)) continue
    const { activeMissionId: _drop, ...rest } = session
    await saveFoundrySession({ ...rest, id: session.id })
    cleared += 1
  }
  return cleared
}

export async function createFoundrySession(input: {
  title: string
  workspaceId?: string
  projectName?: string
  agents?: FoundryRole[]
}): Promise<FoundrySessionRecord> {
  const now = new Date().toISOString()
  return saveFoundrySession({
    id: randomUUID(),
    title: input.title.trim() || 'Coding session',
    workspaceId: input.workspaceId,
    projectName: input.projectName,
    createdAt: now,
    updatedAt: now,
    missionIds: [],
    agents: input.agents ?? ['FOUNDRY_MASTER'],
    chat: [],
    activity: [],
    archived: false,
  })
}

export function isUntouchedEmptySession(session: FoundrySessionRecord): boolean {
  return sessionIsUntouchedEmpty(session)
}

export async function pruneEmptyFoundrySessions(workspaceId?: string): Promise<number> {
  const listed = await listFoundrySessions(workspaceId)
  const byWorkspace = new Map<string, FoundrySessionRecord[]>()
  for (const session of listed) {
    if (!isUntouchedEmptySession(session)) continue
    const key = session.workspaceId ?? '__none__'
    const bucket = byWorkspace.get(key) ?? []
    bucket.push(session)
    byWorkspace.set(key, bucket)
  }
  let archived = 0
  for (const bucket of byWorkspace.values()) {
    bucket.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    for (const extra of bucket.slice(1)) {
      await archiveFoundrySession(extra.id, { archivedBy: 'foundry-session-hygiene' })
      archived += 1
    }
  }
  return archived
}

export async function reuseOrCreateFoundrySession(input: {
  title: string
  workspaceId?: string
  projectName?: string
  agents?: FoundryRole[]
}): Promise<{ session: FoundrySessionRecord; reused: boolean }> {
  const listed = await listFoundrySessions(input.workspaceId)
  const empty = listed.find(isUntouchedEmptySession)
  if (empty) {
    const extras = listed.filter(item => item.id !== empty.id && isUntouchedEmptySession(item))
    for (const extra of extras) {
      await archiveFoundrySession(extra.id, { archivedBy: 'foundry-session-hygiene' })
    }
    return { session: empty, reused: true }
  }
  const extras = listed.filter(isUntouchedEmptySession)
  for (const extra of extras) {
    await archiveFoundrySession(extra.id, { archivedBy: 'foundry-session-hygiene' })
  }
  return {
    session: await createFoundrySession(input),
    reused: false,
  }
}

export async function appendFoundryChat(sessionId: string, speaker: FoundryChatMessage['speaker'], text: string): Promise<FoundrySessionRecord | null> {
  return withRecordLock(`session:${sessionId}`, async () => {
    const session = await getFoundrySession(sessionId)
    if (!session) return null
    session.chat.push({ id: randomUUID(), at: new Date().toISOString(), speaker, text: text.slice(0, 8000) })
    session.chat = session.chat.slice(-400)
    return saveFoundrySession(session)
  })
}

export async function appendFoundryActivity(sessionId: string, role: string, detail: string): Promise<FoundrySessionRecord | null> {
  return withRecordLock(`session:${sessionId}`, async () => {
    const session = await getFoundrySession(sessionId)
    if (!session) return null
    session.activity.push({ at: new Date().toISOString(), role, detail: detail.slice(0, 1000) })
    session.activity = session.activity.slice(-200)
    return saveFoundrySession(session)
  })
}

export async function attachMissionToSession(sessionId: string, missionId: string): Promise<FoundrySessionRecord | null> {
  return withRecordLock(`session:${sessionId}`, async () => {
    const session = await getFoundrySession(sessionId)
    if (!session) return null
    if (!session.missionIds.includes(missionId)) session.missionIds.push(missionId)
    session.activeMissionId = missionId
    return saveFoundrySession(session)
  })
}

export const FOUNDRY_SESSION_TITLE_MAX = 80

export type RenameFoundrySessionResult =
  | { ok: true; session: FoundrySessionRecord }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'EMPTY_TITLE' | 'TOO_LONG' }

export async function renameFoundrySession(id: string, title: string): Promise<RenameFoundrySessionResult> {
  return withRecordLock(`session:${id}`, async () => {
    const session = await getFoundrySession(id)
    if (!session) return { ok: false, error: 'Session not found.', code: 'NOT_FOUND' }
    const next = title.trim()
    if (!next) return { ok: false, error: 'title is required.', code: 'EMPTY_TITLE' }
    if (next.length > FOUNDRY_SESSION_TITLE_MAX) {
      return { ok: false, error: `title exceeds ${FOUNDRY_SESSION_TITLE_MAX} characters.`, code: 'TOO_LONG' }
    }
    const saved = await saveFoundrySession({
      ...session,
      id: session.id,
      title: next,
      workspaceId: session.workspaceId,
      missionIds: session.missionIds,
      activeMissionId: session.activeMissionId,
      chat: session.chat,
      activity: session.activity,
      agents: session.agents,
      createdAt: session.createdAt,
      archived: session.archived,
      archivedAt: session.archivedAt,
      archivedBy: session.archivedBy,
    })
    return { ok: true, session: saved }
  })
}

export type ArchiveFoundrySessionResult =
  | { ok: true; session: FoundrySessionRecord; alreadyArchived: boolean }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'ACTIVE_MISSION' }

export type RestoreFoundrySessionResult =
  | { ok: true; session: FoundrySessionRecord; alreadyRestored: boolean }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'NOT_ARCHIVED' }

export async function archiveFoundrySession(
  id: string,
  input: { archived?: boolean; archivedBy?: string } = {},
): Promise<ArchiveFoundrySessionResult> {
  return withRecordLock(`session:${id}`, async () => {
    const session = await getFoundrySession(id)
    if (!session) return { ok: false, error: 'Session not found.', code: 'NOT_FOUND' }
    if (session.archived === true) {
      return { ok: true, session, alreadyArchived: true }
    }
    if (session.activeMissionId) {
      const { loadMission } = await import('./foundryMissionStore')
      const mission = await loadMission(session.activeMissionId)
      if (mission && FOUNDRY_PROTECTED_MISSION_STATES.has(mission.status)) {
        return {
          ok: false,
          error: 'Session has active mission',
          code: 'ACTIVE_MISSION',
        }
      }
    }
    const now = new Date().toISOString()
    const saved = await saveFoundrySession({
      ...session,
      id: session.id,
      archived: true,
      archivedAt: now,
      archivedBy: input.archivedBy?.trim() || 'local-commander',
      workspaceId: session.workspaceId,
      missionIds: session.missionIds,
      activeMissionId: session.activeMissionId,
      chat: session.chat,
      activity: [
        ...session.activity,
        { at: now, role: 'SYSTEM', detail: 'Session archived. Journals, audit, and mission history retained.' },
      ],
      agents: session.agents,
      createdAt: session.createdAt,
    })
    return { ok: true, session: saved, alreadyArchived: false }
  })
}

export async function restoreFoundrySession(id: string): Promise<RestoreFoundrySessionResult> {
  return withRecordLock(`session:${id}`, async () => {
    const session = await getFoundrySession(id)
    if (!session) return { ok: false, error: 'Session not found.', code: 'NOT_FOUND' }
    if (session.archived !== true) {
      if (session.archivedAt) return { ok: true, session, alreadyRestored: true }
      return { ok: false, error: 'Session is not archived.', code: 'NOT_ARCHIVED' }
    }
    const now = new Date().toISOString()
    const { activeMissionId: _resumeMission, ...rest } = session
    const saved = await saveFoundrySession({
      ...rest,
      id: session.id,
      archived: false,
      archivedAt: session.archivedAt,
      archivedBy: session.archivedBy,
      workspaceId: session.workspaceId,
      missionIds: session.missionIds,
      chat: session.chat,
      activity: [
        ...session.activity,
        { at: now, role: 'SYSTEM', detail: 'Session restored. Historical missions were not resumed.' },
      ],
      agents: session.agents,
      createdAt: session.createdAt,
    })
    return { ok: true, session: saved, alreadyRestored: false }
  })
}
