'use client'

import { useEffect, useMemo, useState } from 'react'

type SessionDayGroup = 'Today' | 'Yesterday' | 'Earlier'

function sessionDayGroup(iso: string | null | undefined, nowMs = Date.now()): SessionDayGroup {
  if (!iso) return 'Earlier'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'Earlier'
  const startOfToday = new Date(nowMs)
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()
  if (then >= today) return 'Today'
  if (then >= today - 86_400_000) return 'Yesterday'
  return 'Earlier'
}

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

export type CouncilSessionView = 'active' | 'trash' | 'archived'
export type CouncilSessionBulkAction = 'trash' | 'restore' | 'archive' | 'unarchive' | 'rename' | 'purge' | 'cleanup-empty'
export type CouncilSessionCounts = { active: number; trashed: number; archived: number; emptyUnused: number }

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

const BTN = 'rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors'
const BTN_NEUTRAL = `${BTN} border-emerald-400/30 text-emerald-200 hover:bg-emerald-400/10`
const BTN_DANGER = `${BTN} border-red-500/50 text-red-300 hover:bg-red-500/10`

export function CouncilSessionNavigator({
  sessions,
  activeId,
  search,
  onSearch,
  onNewChat,
  onSelect,
  onRename,
  onArchive,
  view = 'active',
  onViewChange,
  trashSessions = [],
  archivedSessions = [],
  counts,
  onBulk,
  busy = false,
  notice = null,
}: {
  sessions: CouncilSessionListItem[]
  activeId: string | null
  search: string
  onSearch: (q: string) => void
  onNewChat: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  view?: CouncilSessionView
  onViewChange?: (view: CouncilSessionView) => void
  trashSessions?: CouncilSessionListItem[]
  archivedSessions?: CouncilSessionListItem[]
  counts?: CouncilSessionCounts
  onBulk?: (action: CouncilSessionBulkAction, ids: string[], extra?: { mode?: 'set' | 'prefix' | 'suffix'; text?: string; confirm?: string }) => void | Promise<void>
  busy?: boolean
  notice?: string | null
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkRenameOpen, setBulkRenameOpen] = useState(false)
  const [bulkRenameText, setBulkRenameText] = useState('')
  const [bulkRenameMode, setBulkRenameMode] = useState<'set' | 'prefix' | 'suffix'>('prefix')
  const [confirm, setConfirm] = useState<null | { kind: 'purge-selected' | 'empty-trash' | 'trash-selected'; ids: string[] }>(null)

  const baseRows = view === 'trash' ? trashSessions : view === 'archived' ? archivedSessions : sessions
  const liveSessions = useMemo(
    () => (view === 'active' ? baseRows.filter(s => s.state !== 'archived' && s.state !== 'trashed') : baseRows),
    [baseRows, view],
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return liveSessions
    return liveSessions.filter(s => {
      const title = (s.title ?? '').toLowerCase()
      const preview = (s.preview ?? '').toLowerCase()
      return title.includes(q) || preview.includes(q)
    })
  }, [search, liveSessions])

  // Selection only ever holds ids that are visible in the current view, and resets when the view changes.
  /* eslint-disable react-hooks/set-state-in-effect -- selection is derived UI state that must reset when the view or visible rows change */
  useEffect(() => { setSelected(new Set()); setConfirm(null); setBulkRenameOpen(false) }, [view])
  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(liveSessions.map(s => s.id))
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [liveSessions])
  /* eslint-enable react-hooks/set-state-in-effect */

  const grouped = useMemo(() => {
    const buckets: Record<SessionDayGroup, CouncilSessionListItem[]> = { Today: [], Yesterday: [], Earlier: [] }
    for (const session of filtered) {
      buckets[sessionDayGroup(session.last_message_at || session.updated_at || session.created_at)].push(session)
    }
    return (['Today', 'Yesterday', 'Earlier'] as const).filter(label => buckets[label].length > 0).map(label => ({ label, items: buckets[label] }))
  }, [filtered])

  const selectedIds = [...selected]
  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id))
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const run = async (action: CouncilSessionBulkAction, ids: string[], extra?: { mode?: 'set' | 'prefix' | 'suffix'; text?: string; confirm?: string }) => {
    if (!onBulk || busy) return
    await onBulk(action, ids, extra)
    setSelected(new Set())
    setConfirm(null)
    setBulkRenameOpen(false)
    setBulkRenameText('')
  }
  const tabCount = (v: CouncilSessionView) => counts ? (v === 'active' ? counts.active : v === 'trash' ? counts.trashed : counts.archived) : undefined

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden rounded-xl border border-emerald-400/20 p-2"
      style={{ background: 'rgba(2,8,6,0.85)', boxShadow: 'inset 0 0 30px rgba(0,255,140,0.03)' }}
      data-testid="council-session-navigator"
    >
      <div className="flex items-center justify-between px-1 pt-0.5">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-500/70">Sessions</span>
        {counts ? (
          <span className="text-[9px] text-slate-500" data-testid="council-session-count">
            {counts.active} active{counts.trashed ? ` · ${counts.trashed} in Trash` : ''}
          </span>
        ) : null}
      </div>

      {onViewChange ? (
        <div className="flex gap-1" role="tablist" aria-label="Session views">
          {(['active', 'trash', 'archived'] as const).map(v => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => onViewChange(v)}
              className={`flex-1 rounded border px-1 py-1 text-[9px] font-bold uppercase tracking-wider ${view === v ? 'border-emerald-400/70 bg-emerald-400/10 text-emerald-100' : 'border-emerald-900/50 text-slate-400 hover:text-emerald-200'}`}
              data-testid={`council-session-tab-${v}`}
            >
              {v === 'active' ? 'Sessions' : v === 'trash' ? 'Trash' : 'Archived'}
              {typeof tabCount(v) === 'number' ? ` (${tabCount(v)})` : ''}
            </button>
          ))}
        </div>
      ) : null}

      {view === 'active' ? (
        <button
          type="button"
          onClick={onNewChat}
          className="w-full rounded-lg border border-emerald-400/50 px-2 py-2 text-[11px] font-bold uppercase tracking-widest text-emerald-200 transition-colors hover:bg-emerald-400/10"
          style={{ boxShadow: '0 0 12px rgba(52,211,153,0.12)' }}
          data-testid="council-new-chat"
        >
          + New Chat
        </button>
      ) : null}

      <input
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder={view === 'trash' ? 'Search Trash' : view === 'archived' ? 'Search archived' : 'Search sessions'}
        className="w-full rounded-lg border border-emerald-900/50 bg-black/40 px-2 py-1.5 text-[11px] text-emerald-100 outline-none focus:border-emerald-400/50"
        data-testid="council-session-search"
      />

      {onBulk ? (
        <div className="flex flex-wrap items-center gap-1" data-testid="council-session-toolbar">
          <button type="button" className={BTN_NEUTRAL} disabled={filtered.length === 0 || allFilteredSelected}
            onClick={() => setSelected(new Set(filtered.map(s => s.id)))} data-testid="council-session-select-all">
            Select All
          </button>
          <button type="button" className={BTN_NEUTRAL} disabled={selected.size === 0}
            onClick={() => setSelected(new Set())} data-testid="council-session-deselect-all">
            Deselect All
          </button>
          <span className="text-[9px] text-slate-500" data-testid="council-session-selected-count">{selected.size} selected</span>
        </div>
      ) : null}

      {onBulk && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-emerald-400/20 p-1" data-testid="council-session-bulk-actions">
          {view === 'active' ? (
            <>
              <button type="button" className={BTN_DANGER} disabled={busy}
                onClick={() => setConfirm({ kind: 'trash-selected', ids: selectedIds })} data-testid="council-session-move-to-trash">
                Move to Trash
              </button>
              <button type="button" className={BTN_NEUTRAL} disabled={busy}
                onClick={() => void run('archive', selectedIds)} data-testid="council-session-archive-selected">
                Archive
              </button>
              <button type="button" className={BTN_NEUTRAL} disabled={busy}
                onClick={() => setBulkRenameOpen(open => !open)} data-testid="council-session-rename-selected">
                Rename
              </button>
            </>
          ) : null}
          {view === 'archived' ? (
            <>
              <button type="button" className={BTN_NEUTRAL} disabled={busy}
                onClick={() => void run('unarchive', selectedIds)} data-testid="council-session-unarchive-selected">
                Unarchive
              </button>
              <button type="button" className={BTN_DANGER} disabled={busy}
                onClick={() => setConfirm({ kind: 'trash-selected', ids: selectedIds })} data-testid="council-session-move-to-trash">
                Move to Trash
              </button>
            </>
          ) : null}
          {view === 'trash' ? (
            <>
              <button type="button" className={BTN_NEUTRAL} disabled={busy}
                onClick={() => void run('restore', selectedIds)} data-testid="council-session-restore-selected">
                Restore
              </button>
              <button type="button" className={BTN_DANGER} disabled={busy}
                onClick={() => setConfirm({ kind: 'purge-selected', ids: selectedIds })} data-testid="council-session-purge-selected">
                Delete permanently
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {bulkRenameOpen && view === 'active' && selected.size > 0 ? (
        <div className="space-y-1 rounded-lg border border-emerald-400/20 p-1.5" data-testid="council-session-bulk-rename">
          <div className="flex gap-1">
            {(['prefix', 'suffix', 'set'] as const).map(mode => (
              <button key={mode} type="button" onClick={() => setBulkRenameMode(mode)}
                className={`${BTN} ${bulkRenameMode === mode ? 'border-emerald-400/70 text-emerald-100' : 'border-emerald-900/50 text-slate-400'}`}>
                {mode === 'set' ? 'Set title' : mode}
              </button>
            ))}
          </div>
          <input value={bulkRenameText} onChange={e => setBulkRenameText(e.target.value)} placeholder="Text"
            className="w-full rounded border border-emerald-900/50 bg-black/40 px-1.5 py-1 text-[11px] text-emerald-100 outline-none"
            aria-label="Bulk rename text" data-testid="council-session-bulk-rename-input" />
          <button type="button" className={BTN_NEUTRAL} disabled={busy || !bulkRenameText.trim()}
            onClick={() => void run('rename', selectedIds, { mode: bulkRenameMode, text: bulkRenameText.trim() })}
            data-testid="council-session-bulk-rename-apply">
            Apply to {selected.size}
          </button>
        </div>
      ) : null}

      {view === 'active' && counts && counts.emptyUnused > 0 && onBulk ? (
        <button type="button" className={BTN_NEUTRAL} disabled={busy}
          onClick={() => void run('cleanup-empty', [], undefined)} data-testid="council-session-cleanup-empty"
          title="Moves unused empty sessions to Trash (recoverable). Sessions with messages, research or mission links are never included.">
          Clean up {counts.emptyUnused} empty session{counts.emptyUnused === 1 ? '' : 's'}
        </button>
      ) : null}

      {view === 'trash' && onBulk && (counts?.trashed ?? trashSessions.length) > 0 ? (
        <button type="button" className={BTN_DANGER} disabled={busy}
          onClick={() => setConfirm({ kind: 'empty-trash', ids: trashSessions.map(s => s.id) })} data-testid="council-session-empty-trash">
          Empty Trash
        </button>
      ) : null}

      {confirm ? (
        <div role="alertdialog" aria-label="Confirm" className="space-y-1 rounded-lg border border-red-500/50 bg-red-950/30 p-2" data-testid="council-session-confirm">
          <p className="text-[10px] text-red-200">
            {confirm.kind === 'trash-selected'
              ? `Move ${confirm.ids.length} session${confirm.ids.length === 1 ? '' : 's'} to Trash? They stay recoverable.`
              : `Permanently delete ${confirm.ids.length} session${confirm.ids.length === 1 ? '' : 's'} and all their messages? This cannot be undone.`}
          </p>
          <div className="flex gap-1">
            <button type="button" className={BTN_NEUTRAL} onClick={() => setConfirm(null)} data-testid="council-session-confirm-cancel">Cancel</button>
            <button type="button" className={BTN_DANGER} disabled={busy}
              onClick={() => void run(confirm.kind === 'trash-selected' ? 'trash' : 'purge', confirm.ids, confirm.kind === 'trash-selected' ? undefined : { confirm: 'DELETE_PERMANENTLY' })}
              data-testid="council-session-confirm-yes">
              {confirm.kind === 'trash-selected' ? 'Move to Trash' : 'Delete permanently'}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <p className="px-1 text-[9px] text-emerald-300/80" data-testid="council-session-notice">{notice}</p> : null}

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto" data-testid="council-session-list">
        {filtered.length === 0 ? (
          <li
            className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-emerald-900/50 px-3 py-6 text-center"
            data-testid="council-session-empty-state"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/60">
              {liveSessions.length === 0 ? (view === 'trash' ? 'Trash is empty' : view === 'archived' ? 'Nothing archived' : 'No sessions yet') : 'No matches'}
            </p>
            {liveSessions.length === 0 && view === 'active' ? (
              <>
                <p className="text-[10px] text-slate-600">Your missions will appear here</p>
                <p className="text-[9px] text-slate-700">Council will name sessions after first response &middot; rename anytime</p>
              </>
            ) : liveSessions.length > 0 ? (
              <p className="text-[10px] text-slate-600">Try a different search term</p>
            ) : null}
          </li>
        ) : (
          grouped.flatMap(group => [
            <li key={`group-${group.label}`} className="px-1 pt-2 text-[8px] font-bold uppercase tracking-[0.22em] text-emerald-600/80">
              {group.label}
            </li>,
            ...group.items.map(session => {
              const active = session.id === activeId
              const preview = session.preview?.trim() || 'Empty session'
              const renaming = renamingId === session.id
              const isSelected = selected.has(session.id)
              return (
                <li key={session.id}>
                  <div
                    className="group relative overflow-hidden rounded-xl border px-2.5 py-2 transition-all"
                    style={{
                      borderColor: isSelected ? 'rgba(250,204,21,0.6)' : active ? 'rgba(52,211,153,0.7)' : 'rgba(52,211,153,0.16)',
                      background: active ? 'rgba(16,64,48,0.35)' : 'rgba(6,20,16,0.55)',
                      boxShadow: active ? '0 0 16px rgba(52,211,153,0.22), inset 0 0 12px rgba(52,211,153,0.06)' : 'none',
                    }}
                    data-testid="council-session-pod"
                    data-session-id={session.id}
                    data-active={active}
                    data-selected={isSelected}
                  >
                    {onBulk ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(session.id)}
                        aria-label={`Select ${session.title || 'session'}`}
                        className="absolute left-1.5 top-2 h-3 w-3 accent-emerald-400"
                        data-testid="council-session-checkbox"
                      />
                    ) : null}
                    {!renaming ? (
                      <button
                        type="button"
                        onClick={() => { if (view === 'active') onSelect(session.id); else toggle(session.id) }}
                        className={`block w-full text-left ${onBulk ? 'pl-5' : ''}`}
                        aria-current={active ? 'true' : undefined}
                      >
                        <div className="flex items-start justify-between gap-2 pr-9">
                          <span className="truncate text-[11px] font-semibold text-emerald-100">{session.title || 'Untitled thread'}</span>
                          <span className="shrink-0 text-[9px] text-slate-500">{relativeTime(session.last_message_at || session.updated_at)}</span>
                        </div>
                        {preview ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{preview}</p> : null}
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 pr-9 pl-5">
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

                    {!renaming && view === 'active' ? (
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
                          aria-label="Move session to Trash"
                          title="Move to Trash"
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
            }),
          ])
        )}
      </ul>
    </aside>
  )
}
