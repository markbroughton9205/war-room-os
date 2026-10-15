/**
 * Local Commander session ledger.
 * The rail reads this immediately. Remote conversations merge in when persistence is up.
 * Reload restores the same ids and does not mint a second row for an existing id.
 */

export const COMMANDER_SESSION_LEDGER_KEY = 'war-room-commander-session-ledger-v1'

export type LedgerSession = {
  id: string
  title: string
  created_at?: string | null
  updated_at?: string | null
  last_message_at?: string | null
  state?: string
  preview?: string | null
  metadata?: Record<string, unknown> | null
}

export function createLedgerSession(id: string, title = 'New Council Session', now = new Date().toISOString()): LedgerSession {
  return {
    id,
    title,
    created_at: now,
    updated_at: now,
    last_message_at: null,
    state: 'active',
    preview: null,
    metadata: { council: { source: 'live_council' } },
  }
}

export function readSessionLedger(): LedgerSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(COMMANDER_SESSION_LEDGER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is LedgerSession => Boolean(row) && typeof row === 'object' && typeof (row as LedgerSession).id === 'string')
  } catch {
    return []
  }
}

export function writeSessionLedger(rows: readonly LedgerSession[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COMMANDER_SESSION_LEDGER_KEY, JSON.stringify(rows))
  } catch {
    /* quota — in-memory rail still works for this tab */
  }
}

export function upsertLedgerSession(rows: readonly LedgerSession[], row: LedgerSession): LedgerSession[] {
  const next = rows.some(item => item.id === row.id)
    ? rows.map(item => item.id === row.id ? { ...item, ...row } : item)
    : [row, ...rows]
  const seen = new Set<string>()
  return next.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return item.state !== 'archived' && item.state !== 'trashed'
  })
}

/** Remote rows win field conflicts. Local-only ids stay. Ids are unique. */
export function mergeSessionLists(remote: readonly LedgerSession[], local: readonly LedgerSession[]): LedgerSession[] {
  const byId = new Map<string, LedgerSession>()
  for (const row of local) {
    if (!row.id || byId.has(row.id)) continue
    byId.set(row.id, row)
  }
  for (const row of remote) {
    if (!row.id) continue
    const prior = byId.get(row.id)
    byId.set(row.id, prior ? { ...prior, ...row, id: row.id } : row)
  }
  return [...byId.values()].filter(row => row.state !== 'archived' && row.state !== 'trashed')
}

/**
 * A browser-ledger row that exists only locally, was never used (default title, no preview, no message time) and is not the bound
 * session. These are the "New Council Session / Empty session" ghosts: they were minted by a client id and never reached the server.
 */
export function isGhostLedgerRow(row: LedgerSession, remoteIds: ReadonlySet<string>, activeId: string | null): boolean {
  if (remoteIds.has(row.id) || row.id === activeId) return false
  const title = (row.title ?? '').trim()
  if (title && title !== 'New Council Session') return false
  if (row.preview && row.preview.trim()) return false
  if (row.last_message_at) return false
  return true
}

export function pruneGhostLedgerRows(rows: readonly LedgerSession[], remoteIds: ReadonlySet<string>, activeId: string | null): LedgerSession[] {
  return rows.filter(row => !isGhostLedgerRow(row, remoteIds, activeId))
}

export function retitleLedgerSession(rows: readonly LedgerSession[], id: string, title: string, preview?: string | null): LedgerSession[] {
  const now = new Date().toISOString()
  return rows.map(row => row.id === id ? {
    ...row,
    title,
    preview: preview ?? row.preview ?? null,
    updated_at: now,
    last_message_at: now,
  } : row)
}
