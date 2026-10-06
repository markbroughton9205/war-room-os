/**
 * Per-session local transcript. Remote persistence is optional.
 * Reload and session switch read this map when the remote thread is unavailable.
 */

import type { EbcPublicSnapshotSummary } from '@/lib/council/evidence-board/types'

export const COMMANDER_TRANSCRIPT_KEY = 'war-room-commander-session-transcripts-v1'

export type LocalTranscriptMessage = {
  id: string
  familyName: string
  content: string
  timestamp: string
  color: string
  icon: string
  provider: string
  messageType: string
  evidenceBoardCouncil?: EbcPublicSnapshotSummary
}

export type TranscriptStore = Record<string, LocalTranscriptMessage[]>

const MAX_MESSAGES = 80
const MAX_CONTENT = 20_000

export function toLocalTranscriptMessage(message: {
  id: string
  familyName: string
  content: string
  timestamp?: string
  color?: string
  icon?: string
  provider?: string
  messageType?: string
  evidenceBoardCouncil?: LocalTranscriptMessage['evidenceBoardCouncil']
}): LocalTranscriptMessage | null {
  const content = message.content.trim().slice(0, MAX_CONTENT)
  const id = message.id.trim()
  if (!id || !content) return null
  const snapshot = message.evidenceBoardCouncil
  const evidenceBoardCouncil = snapshot ? {
    mission_class: snapshot.mission_class,
    completion_state: snapshot.completion_state,
    usable_source_count: snapshot.usable_source_count,
    sources: snapshot.sources,
    evidence: snapshot.evidence,
  } : undefined
  return {
    id,
    familyName: message.familyName || 'Council',
    content,
    timestamp: message.timestamp || '',
    color: message.color || '#93C5FD',
    icon: message.icon || '◆',
    provider: message.provider || '',
    messageType: message.messageType || 'response',
    evidenceBoardCouncil,
  }
}

export function writeSessionTranscript(
  store: TranscriptStore,
  sessionId: string,
  messages: readonly LocalTranscriptMessage[],
): TranscriptStore {
  const id = sessionId.trim()
  if (!id) return store
  const clipped = messages.slice(-MAX_MESSAGES)
  return { ...store, [id]: clipped }
}

export function overlayLocalResearchSnapshots<T extends { id: string; content: string; evidenceBoardCouncil?: LocalTranscriptMessage['evidenceBoardCouncil'] }>(
  remote: readonly T[],
  local: readonly LocalTranscriptMessage[],
): T[] {
  const byId = new Map(local.map(row => [row.id, row]))
  const byContent = new Map(local.filter(row => row.evidenceBoardCouncil).map(row => [row.content.trim(), row]))
  return remote.map(row => {
    const hit = byId.get(row.id) ?? byContent.get(row.content.trim())
    if (!hit?.evidenceBoardCouncil) return row
    return { ...row, evidenceBoardCouncil: hit.evidenceBoardCouncil }
  })
}

export function readSessionTranscript(store: TranscriptStore, sessionId: string): LocalTranscriptMessage[] {
  const rows = store[sessionId]
  return Array.isArray(rows) ? rows : []
}

export function parseTranscriptStore(raw: string | null): TranscriptStore {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: TranscriptStore = {}
    for (const [id, rows] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(rows)) continue
      const messages = rows
        .map(row => {
          if (!row || typeof row !== 'object') return null
          const item = row as Partial<LocalTranscriptMessage>
          if (typeof item.id !== 'string' || typeof item.content !== 'string' || typeof item.familyName !== 'string') return null
          return toLocalTranscriptMessage({
            id: item.id,
            familyName: item.familyName,
            content: item.content,
            timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
            color: typeof item.color === 'string' ? item.color : undefined,
            icon: typeof item.icon === 'string' ? item.icon : undefined,
            provider: typeof item.provider === 'string' ? item.provider : undefined,
            messageType: typeof item.messageType === 'string' ? item.messageType : undefined,
            evidenceBoardCouncil: item.evidenceBoardCouncil,
          })
        })
        .filter((row): row is LocalTranscriptMessage => Boolean(row))
      if (messages.length) out[id] = messages
    }
    return out
  } catch {
    return {}
  }
}
