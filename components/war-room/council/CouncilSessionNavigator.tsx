'use client'

import { useMemo, useState } from 'react'

export type CouncilSessionListItem = {
  id: string
  title: string
  last_message_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  state?: string
  preview?: string | null
  metadata?: Record<string, unknown> | null
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const delta = Date.now() - then
  const m = Math.round(delta / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

export function CouncilSessionNavigator({
  sessions,
  activeId,
  search,
  onSearch,
  onNewChat,
  onSelect,
  onRename,
  onArchive,
}: {
  sessions: CouncilSessionListItem[]
  activeId: string | null
  search: string
  onSearch: (q: string) => void
  onNewChat: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(s => {
      const title = (s.title ?? '').toLowerCase()
      const preview = (s.preview ?? '').toLowerCase()
      return title.includes(q) || preview.includes(q)
    })
  }, [search, sessions])

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden rounded border border-emerald-900/40 p-2"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      data-testid="council-session-navigator"
    >
      <button
        type="button"
        onClick={onNewChat}
        className="w-full rounded border border-emerald-500/50 px-2 py-2 text-[11px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-950/40"
        data-testid="council-new-chat"
      >
        + New Chat
      </button>
      <input
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder="Search sessions"
        className="w-full rounded border border-emerald-900/50 bg-black/40 px-2 py-1.5 text-[11px] text-emerald-100 outline-none"
        data-testid="council-session-search"
      />
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" data-testid="council-session-list">
        {filtered.map(session => {
          const active = session.id === activeId
          const preview = session.preview?.trim() || 'Empty session'
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelect(session.id)}
                className="w-full rounded px-2 py-2 text-left"
                style={{
                  border: active ? '1px solid rgba(52,211,153,0.55)' : '1px solid transparent',
                  background: active ? 'rgba(0,255,102,0.08)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-emerald-100">{session.title || 'Untitled thread'}</span>
                  <span className="shrink-0 text-[9px] text-slate-500">{relativeTime(session.last_message_at || session.updated_at)}</span>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-slate-500">{preview}</p>
              </button>
              <div className="mt-0.5 flex gap-1 px-1">
                {renamingId === session.id ? (
                  <>
                    <input
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-emerald-900/50 bg-black px-1 text-[10px] text-emerald-100"
                      aria-label="Rename session"
                    />
                    <button
                      type="button"
                      className="text-[9px] text-emerald-300"
                      onClick={() => {
                        onRename(session.id, renameValue)
                        setRenamingId(null)
                      }}
                    >
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="text-[9px] text-slate-500"
                      onClick={() => {
                        setRenamingId(session.id)
                        setRenameValue(session.title)
                      }}
                    >
                      Rename
                    </button>
                    {session.state !== 'archived' ? (
                      <button type="button" className="text-[9px] text-slate-500" onClick={() => onArchive(session.id)}>
                        Archive
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
