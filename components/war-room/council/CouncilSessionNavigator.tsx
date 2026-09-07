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

/** Pencil glyph -- kept as an inline SVG (no icon library dependency) for the rename affordance. */
function IconRename() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M11.5 2.5 13.5 4.5 5 13 2.5 13.5 3 11 11.5 2.5Z" strokeLinejoin="round" />
    </svg>
  )
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
  const liveSessions = useMemo(() => sessions.filter(s => s.state !== 'archived'), [sessions])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return liveSessions
    return liveSessions.filter(s => {
      const title = (s.title ?? '').toLowerCase()
      const preview = (s.preview ?? '').toLowerCase()
      return title.includes(q) || preview.includes(q)
    })
  }, [search, liveSessions])

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden rounded-xl border border-emerald-400/20 p-2"
      style={{ background: 'rgba(2,8,6,0.85)', boxShadow: 'inset 0 0 30px rgba(0,255,140,0.03)' }}
      data-testid="council-session-navigator"
    >
      <div className="px-1 pt-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-500/70">Sessions</div>
      <button
        type="button"
        onClick={onNewChat}
        className="w-full rounded-lg border border-emerald-400/50 px-2 py-2 text-[11px] font-bold uppercase tracking-widest text-emerald-200 transition-colors hover:bg-emerald-400/10"
        style={{ boxShadow: '0 0 12px rgba(52,211,153,0.12)' }}
        data-testid="council-new-chat"
      >
        + New Chat
      </button>
      <input
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder="Search sessions"
        className="w-full rounded-lg border border-emerald-900/50 bg-black/40 px-2 py-1.5 text-[11px] text-emerald-100 outline-none focus:border-emerald-400/50"
        data-testid="council-session-search"
      />
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto" data-testid="council-session-list">
        {filtered.length === 0 ? (
          <li
            className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-emerald-900/50 px-3 py-6 text-center"
            data-testid="council-session-empty-state"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/60">
              {liveSessions.length === 0 ? 'No sessions yet' : 'No matches'}
            </p>
            {liveSessions.length === 0 ? (
              <>
                <p className="text-[10px] text-slate-600">Your missions will appear here</p>
                <p className="text-[9px] text-slate-700">
                  Council will name sessions after first response &middot; rename anytime &middot; &times; delete
                </p>
              </>
            ) : (
              <p className="text-[10px] text-slate-600">Try a different search term</p>
            )}
          </li>
        ) : (
          filtered.map(session => {
            const active = session.id === activeId
            const preview = session.preview?.trim() || 'Empty session'
            const renaming = renamingId === session.id
            return (
              <li key={session.id}>
                <div
                  className="group relative overflow-hidden rounded-xl border px-2.5 py-2 transition-all"
                  style={{
                    borderColor: active ? 'rgba(52,211,153,0.7)' : 'rgba(52,211,153,0.16)',
                    background: active ? 'rgba(16,64,48,0.35)' : 'rgba(6,20,16,0.55)',
                    boxShadow: active ? '0 0 16px rgba(52,211,153,0.22), inset 0 0 12px rgba(52,211,153,0.06)' : 'none',
                  }}
                  data-testid="council-session-pod"
                  data-active={active}
                >
                  {!renaming ? (
                    <button
                      type="button"
                      onClick={() => onSelect(session.id)}
                      className="block w-full text-left"
                      aria-current={active ? 'true' : undefined}
                    >
                      <div className="flex items-start justify-between gap-2 pr-9">
                        <span className="truncate text-[11px] font-semibold text-emerald-100">
                          {session.title || 'Untitled thread'}
                        </span>
                        <span className="shrink-0 text-[9px] text-slate-500">
                          {relativeTime(session.last_message_at || session.updated_at)}
                        </span>
                      </div>
                      {preview ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{preview}</p> : null}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 pr-9">
                      <input
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && renameValue.trim()) {
                            onRename(session.id, renameValue.trim())
                            setRenamingId(null)
                          }
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="min-w-0 flex-1 rounded border border-emerald-400/40 bg-black px-1.5 py-0.5 text-[11px] text-emerald-100 outline-none"
                        aria-label="Rename session"
                        autoFocus
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 hover:bg-emerald-400/10"
                        onClick={() => {
                          if (renameValue.trim()) onRename(session.id, renameValue.trim())
                          setRenamingId(null)
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {!renaming ? (
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-emerald-400/10 hover:text-emerald-300"
                        aria-label="Rename session"
                        title="Rename"
                        onClick={e => {
                          e.stopPropagation()
                          setRenamingId(session.id)
                          setRenameValue(session.title)
                        }}
                      >
                        <IconRename />
                      </button>
                      <button
                        type="button"
                        className="grid h-5 w-5 place-items-center rounded text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                        aria-label="Delete session"
                        title="Delete"
                        onClick={e => {
                          e.stopPropagation()
                          onArchive(session.id)
                        }}
                      >
                        <span className="text-[12px] leading-none">&times;</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })
        )}
      </ul>
    </aside>
  )
}
