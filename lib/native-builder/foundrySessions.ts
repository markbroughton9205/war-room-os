/**
 * Persistent Foundry coding sessions — not Council chats.
 * Stored beside native-builder repairs under the authorized workspace.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { FoundryRole } from './foundryRoles'

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
}

function sessionsDir(): string {
  return path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'foundry-sessions')
}

function isSession(v: unknown): v is FoundrySessionRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.title === 'string' && Array.isArray(o.chat) && Array.isArray(o.missionIds)
}

export async function listFoundrySessions(workspaceId?: string): Promise<FoundrySessionRecord[]> {
  let names: string[]
  try {
    names = (await readdir(sessionsDir())).filter(n => n.endsWith('.json'))
  } catch {
    return []
  }
  const out: FoundrySessionRecord[] = []
  for (const name of names) {
    try {
      const parsed = JSON.parse(await readFile(path.join(sessionsDir(), name), 'utf8')) as unknown
      if (isSession(parsed) && (!workspaceId || parsed.workspaceId === workspaceId)) out.push(parsed)
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getFoundrySession(id: string): Promise<FoundrySessionRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(sessionsDir(), `${id}.json`), 'utf8')) as unknown
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function saveFoundrySession(session: FoundrySessionRecord): Promise<FoundrySessionRecord> {
  const dir = sessionsDir()
  await mkdir(dir, { recursive: true })
  const next = { ...session, updatedAt: new Date().toISOString() }
  await writeFile(path.join(dir, `${session.id}.json`), JSON.stringify(next, null, 2), 'utf8')
  return next
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
  })
}

export async function appendFoundryChat(sessionId: string, speaker: FoundryChatMessage['speaker'], text: string): Promise<FoundrySessionRecord | null> {
  const session = await getFoundrySession(sessionId)
  if (!session) return null
  session.chat.push({ id: randomUUID(), at: new Date().toISOString(), speaker, text: text.slice(0, 8000) })
  session.chat = session.chat.slice(-400)
  return saveFoundrySession(session)
}

export async function appendFoundryActivity(sessionId: string, role: string, detail: string): Promise<FoundrySessionRecord | null> {
  const session = await getFoundrySession(sessionId)
  if (!session) return null
  session.activity.push({ at: new Date().toISOString(), role, detail: detail.slice(0, 1000) })
  session.activity = session.activity.slice(-200)
  return saveFoundrySession(session)
}

export async function attachMissionToSession(sessionId: string, missionId: string): Promise<FoundrySessionRecord | null> {
  const session = await getFoundrySession(sessionId)
  if (!session) return null
  if (!session.missionIds.includes(missionId)) session.missionIds.push(missionId)
  session.activeMissionId = missionId
  return saveFoundrySession(session)
}
