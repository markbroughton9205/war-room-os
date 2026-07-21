'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { WarRoomEvent } from '@/lib/events/types'
import { classifyWarRoomEvent, type ClassifiedNotification, type NotificationSeverity } from '@/lib/notifications/classify'

const POLL_MS = 20_000

type NotificationRow = ClassifiedNotification & { id: string; createdAt: string }

function severityColor(severity: NotificationSeverity): string {
  if (severity === 'urgent') return '#F87171'
  if (severity === 'error') return '#FCA5A5'
  return '#93C5FD'
}

function severityLabel(severity: NotificationSeverity): string {
  if (severity === 'urgent') return 'Urgent'
  if (severity === 'error') return 'Error'
  return 'Info'
}

function NotificationList({ rows }: { rows: NotificationRow[] }) {
  if (!rows.length) {
    return <p className="text-[10px] text-slate-500">None right now.</p>
  }
  return (
    <ul className="space-y-1.5">
      {rows.map(row => (
        <li
          key={row.id}
          className="rounded p-2 text-[10px] leading-relaxed"
          style={{ border: `1px solid ${severityColor(row.severity)}33`, background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-200">{row.title}</span>
            <span className="text-[9px] text-slate-500">{new Date(row.createdAt).toLocaleTimeString()}</span>
          </div>
          <p className="mt-1 text-slate-400">{row.detail}</p>
        </li>
      ))}
    </ul>
  )
}

export function NotificationsCenterPanel() {
  const [events, setEvents] = useState<WarRoomEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pollGuardRef = useRef({ consecutiveFailures: 0, pauseUntil: 0 })
  const inFlightRef = useRef(false)

  const load = useCallback(async () => {
    const now = Date.now()
    if (now < pollGuardRef.current.pauseUntil) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    try {
      const res = await fetch('/api/events/recent?limit=50', { cache: 'no-store' })
      const j = await res.json() as { events?: WarRoomEvent[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'Failed to load events')
      setEvents(Array.isArray(j.events) ? j.events : [])
      setError(null)
      pollGuardRef.current.consecutiveFailures = 0
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events')
      pollGuardRef.current.consecutiveFailures += 1
      if (pollGuardRef.current.consecutiveFailures >= 3) {
        pollGuardRef.current.pauseUntil = Date.now() + 30_000
        pollGuardRef.current.consecutiveFailures = 0
      }
    } finally {
      setLoading(false)
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [load])

  const rows = useMemo<NotificationRow[]>(
    () => events.map(event => ({ id: event.id, createdAt: event.createdAt, ...classifyWarRoomEvent(event) })),
    [events],
  )
  const urgent = useMemo(() => rows.filter(row => row.severity === 'urgent'), [rows])
  const errors = useMemo(() => rows.filter(row => row.severity === 'error'), [rows])
  const info = useMemo(() => rows.filter(row => row.severity === 'info'), [rows])

  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold uppercase tracking-widest text-slate-200">Notifications</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded border border-white/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
        >
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      {error ? (
        <p className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-200">{error}</p>
      ) : null}

      <div className="mt-3 space-y-3">
        <section>
          <h4 className="text-[9px] font-bold uppercase tracking-widest" style={{ color: severityColor('urgent') }}>
            {severityLabel('urgent')} ({urgent.length})
          </h4>
          <div className="mt-1.5">
            <NotificationList rows={urgent} />
          </div>
        </section>

        <section>
          <h4 className="text-[9px] font-bold uppercase tracking-widest" style={{ color: severityColor('error') }}>
            {severityLabel('error')} ({errors.length})
          </h4>
          <div className="mt-1.5">
            <NotificationList rows={errors} />
          </div>
        </section>

        <details>
          <summary
            className="cursor-pointer text-[9px] font-bold uppercase tracking-widest"
            style={{ color: severityColor('info') }}
          >
            {severityLabel('info')} ({info.length})
          </summary>
          <div className="mt-1.5">
            <NotificationList rows={info} />
          </div>
        </details>
      </div>
    </section>
  )
}
