/**
 * One durable session file is the reasoning source of truth.
 * The mission pointer stores the reference, brief, and status.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pointerStoresGraph, type MissionReasoningPointer } from './attachment'
import { restoreSession, serializeSession } from './session'
import type { FoundryReasoningSession } from './types'

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_')
}

export async function saveCanonicalSession(root: string, session: FoundryReasoningSession): Promise<string> {
  const dir = path.join(root, 'reasoning-sessions')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${safeId(session.sessionId)}.json`)
  await writeFile(file, serializeSession(session), 'utf8')
  return file
}

export async function loadCanonicalSession(root: string, sessionId: string): Promise<FoundryReasoningSession> {
  const file = path.join(root, 'reasoning-sessions', `${safeId(sessionId)}.json`)
  return restoreSession(await readFile(file, 'utf8'))
}

export async function saveMissionPointer(root: string, pointer: MissionReasoningPointer): Promise<string> {
  if (pointerStoresGraph(pointer)) {
    throw new Error('Mission pointer cannot store a second reasoning graph.')
  }
  const dir = path.join(root, 'mission-pointers')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${safeId(pointer.missionId)}.json`)
  await writeFile(file, JSON.stringify(pointer), 'utf8')
  return file
}

export async function loadMissionPointer(root: string, missionId: string): Promise<MissionReasoningPointer> {
  const file = path.join(root, 'mission-pointers', `${safeId(missionId)}.json`)
  return JSON.parse(await readFile(file, 'utf8')) as MissionReasoningPointer
}
