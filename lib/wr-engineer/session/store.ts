/**
 * WR-Engineer engineering session store — Phase 2 dev backend.
 *
 * JSON-file-backed under .war-room/wr-engineer/session/, same convention as
 * lib/wr-engineer/memory/store.ts and lib/wr-engineer/node/store.ts. See
 * supabase/war_room_phase57a_wr_engineer_nodes.sql for the corresponding (not-applied) Supabase
 * schema a production deployment would move this to.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { EngineeringChatMessage, EngineeringSession, ToolActivityEvent } from './types'

export interface SessionStore {
  saveSession(session: EngineeringSession): Promise<void>
  getSession(sessionId: string): Promise<EngineeringSession | null>
  listSessions(): Promise<EngineeringSession[]>

  appendMessage(message: EngineeringChatMessage): Promise<void>
  listMessages(sessionId: string): Promise<EngineeringChatMessage[]>

  appendToolEvent(event: ToolActivityEvent): Promise<void>
  listToolEvents(sessionId: string): Promise<ToolActivityEvent[]>
}

function sessionDir(): string {
  return path.join(resolveRepoRoot(), '.war-room', 'wr-engineer', 'session')
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return []
    throw error
  }
}

async function writeJsonArray<T>(filePath: string, records: T[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8')
}

export class JsonFileSessionStore implements SessionStore {
  private readonly sessionsPath: string
  private readonly messagesPath: string
  private readonly toolEventsPath: string

  constructor(baseDir: string = sessionDir()) {
    this.sessionsPath = path.join(baseDir, 'sessions.json')
    this.messagesPath = path.join(baseDir, 'messages.json')
    this.toolEventsPath = path.join(baseDir, 'tool-events.json')
  }

  async saveSession(session: EngineeringSession): Promise<void> {
    const sessions = await readJsonArray<EngineeringSession>(this.sessionsPath)
    const idx = sessions.findIndex(s => s.sessionId === session.sessionId)
    if (idx >= 0) sessions[idx] = session
    else sessions.push(session)
    await writeJsonArray(this.sessionsPath, sessions)
  }

  async getSession(sessionId: string): Promise<EngineeringSession | null> {
    const sessions = await readJsonArray<EngineeringSession>(this.sessionsPath)
    return sessions.find(s => s.sessionId === sessionId) ?? null
  }

  async listSessions(): Promise<EngineeringSession[]> {
    return readJsonArray<EngineeringSession>(this.sessionsPath)
  }

  async appendMessage(message: EngineeringChatMessage): Promise<void> {
    const messages = await readJsonArray<EngineeringChatMessage>(this.messagesPath)
    messages.push(message)
    await writeJsonArray(this.messagesPath, messages)
  }

  async listMessages(sessionId: string): Promise<EngineeringChatMessage[]> {
    const messages = await readJsonArray<EngineeringChatMessage>(this.messagesPath)
    return messages.filter(m => m.sessionId === sessionId)
  }

  async appendToolEvent(event: ToolActivityEvent): Promise<void> {
    const events = await readJsonArray<ToolActivityEvent>(this.toolEventsPath)
    events.push(event)
    await writeJsonArray(this.toolEventsPath, events)
  }

  async listToolEvents(sessionId: string): Promise<ToolActivityEvent[]> {
    const events = await readJsonArray<ToolActivityEvent>(this.toolEventsPath)
    return events.filter(e => e.sessionId === sessionId)
  }
}

export const wrEngineerSessionStore: SessionStore = new JsonFileSessionStore()
