'use client'

import { useCallback, useEffect, useState } from 'react'
import { grantWarRoomStandingAck, resolveStandingPostExtra } from '@/lib/permissions/standingInlineGate'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import { WORKER_IDS } from '@/lib/workers/types'
import type { WarRoomEvent } from '@/lib/events/types'
import type { WarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'

function readPersistence(res: Response) {
  return res.headers.get('x-war-room-persistence') ?? 'unknown'
}

type WorkerRunRow = {
  id: string
  worker_id: string
  ok: boolean
  detail: Record<string, unknown>
  error: string | null
  created_at: string
}

export function Phase4WarRoomPanels({ uiMode }: { uiMode: WarRoomUiMode }) {
  const [persistence, setPersistence] = useState<string>('unknown')
  const [events, setEvents] = useState<WarRoomEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)

  const [workerStatus, setWorkerStatus] = useState<{ workerId: string; lastRun: WorkerRunRow | null }[]>([])
  const [workerStatusLoading, setWorkerStatusLoading] = useState(false)
  const [runBusy, setRunBusy] = useState<string | null>(null)

  const [orchOut, setOrchOut] = useState<string | null>(null)
  const [orchBusy, setOrchBusy] = useState(false)

  const [permSnap, setPermSnap] = useState<{ mode: StandingPermissionMode; safetyLock: boolean } | null>(null)

  const loadPermissionsSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/permissions/status', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { mode?: string; safetyLock?: boolean }
      if (res.ok && (j.mode === 'manual' || j.mode === 'operator' || j.mode === 'commander')) {
        setPermSnap({ mode: j.mode, safetyLock: Boolean(j.safetyLock) })
      }
    } catch {
      /* ignore */
    }
  }, [])

  const [elevPermissionHint, setElevPermissionHint] = useState<string | null>(null)

  const standingPostExtra = useCallback((actionKind: string) => resolveStandingPostExtra(permSnap, actionKind), [permSnap])

  const [eventsExpanded, setEventsExpanded] = useState(false)

  const loadEvents = useCallback(async () => {
    setEventsLoading(true)
    try {
      const res = await fetch('/api/events/recent?limit=25', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { events?: WarRoomEvent[] }
      setEvents(Array.isArray(j.events) ? j.events : [])
    } catch {
      setEvents([])
    } finally {
      setEventsLoading(false)
    }
  }, [])

  const loadWorkerStatus = useCallback(async () => {
    setWorkerStatusLoading(true)
    try {
      const res = await fetch('/api/workers/status', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as { workers?: { workerId: string; lastRun: WorkerRunRow | null }[] }
      setWorkerStatus(Array.isArray(j.workers) ? j.workers : [])
    } catch {
      setWorkerStatus([])
    } finally {
      setWorkerStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadPermissionsSnapshot()
      if (uiMode !== 'operator') void loadEvents()
      void loadWorkerStatus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [loadEvents, loadPermissionsSnapshot, loadWorkerStatus, uiMode])

  const triggerWorkerRun = async (workerId: string) => {
    setRunBusy(workerId)
    try {
      const gate = standingPostExtra('engine_probe')
      if (!gate.proceed) {
        if (gate.needsAck && gate.ackMessage) setElevPermissionHint(gate.ackMessage)
        return
      }
      const { extra } = gate
      const res = await fetch('/api/workers/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId, ...extra }),
      })
      setPersistence(readPersistence(res))
      await loadWorkerStatus()
      await loadEvents()
    } finally {
      setRunBusy(null)
    }
  }

  const runOrchestration = async () => {
    setOrchBusy(true)
    setOrchOut(null)
    try {
      const gate = standingPostExtra('route_planning')
      if (!gate.proceed) {
        if (gate.needsAck && gate.ackMessage) setElevPermissionHint(gate.ackMessage)
        return
      }
      const { extra } = gate
      const res = await fetch('/api/orchestration/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'noop', maxSteps: 1, ...extra }),
      })
      setPersistence(readPersistence(res))
      const j = await res.json()
      setOrchOut(JSON.stringify(j, null, 2))
      void loadEvents()
    } catch (e) {
      setOrchOut(e instanceof Error ? e.message : 'orchestration failed')
    } finally {
      setOrchBusy(false)
    }
  }

  const orchControls = (
    <>
      <p className="mb-2 text-[9px]" style={{ color: '#888' }}>POST /api/orchestration/task — one bounded orchestration step.</p>
      <button type="button" className="mb-2 rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#1D4ED8', color: '#fff' }} disabled={orchBusy} onClick={() => void runOrchestration()}>
        {orchBusy ? 'RUNNING…' : 'RUN ORCHESTRATION STEP'}
      </button>
      <textarea className="h-32 w-full rounded bg-black px-2 py-1 font-mono text-[9px]" style={{ border: '1px solid #333', color: '#94a3b8' }} readOnly value={orchOut ?? ''} placeholder="Last orchestration response (JSON)" />
    </>
  )

  const activityInner = (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest" style={{ color: '#C4B5FD' }}>ACTIVITY STREAM</span>
        <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void loadEvents()} disabled={eventsLoading}>REFRESH</button>
      </div>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-[10px] font-mono" style={{ color: '#a8a29e' }}>
        {(uiMode === 'operator' && !eventsExpanded ? events.slice(0, 3) : events.slice(0, 18)).map(ev => (
          <li key={ev.id} className="border-b border-white/5 pb-1">
            <span style={{ color: '#D8B4FE' }}>{ev.type}</span>
            {' '}
            <span className="opacity-60">{ev.createdAt?.slice(5, 22)}</span>
          </li>
        ))}
        {!events.length && <li style={{ color: '#666' }}>No events yet. When persistence is online, recent events appear here.</li>}
      </ul>
      <p className="mt-2 text-[9px]" style={{ color: '#666' }}>Persistence: {persistence}</p>
    </>
  )

  return (
    <div className="space-y-4 border-t border-yellow-900/40 pt-4">
      {elevPermissionHint && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-700/40 px-3 py-2 text-[10px]" style={{ background: 'rgba(251,191,36,0.1)' }}>
          <span className="max-w-[70%]" style={{ color: '#FDE68A' }}>{elevPermissionHint}</span>
          <div className="flex gap-2">
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: '#FBBF24', color: '#000' }} onClick={() => { grantWarRoomStandingAck(); setElevPermissionHint(null) }}>Approve for this tab</button>
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#888' }} onClick={() => setElevPermissionHint(null)}>Dismiss</button>
          </div>
        </div>
      )}
      <h3 className="text-[10px] font-bold tracking-widest" style={{ color: '#A78BFA' }}>AUTOMATION & EVENTS</h3>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded p-3 text-xs" style={{ border: '1px solid #1e3a5f', background: 'rgba(30,58,95,0.2)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#93C5FD' }}>MISSION CONTROL</span>
          </div>
          {uiMode === 'operator' ? (
            <details className="rounded border border-white/10 bg-black/20 p-2">
              <summary className="cursor-pointer text-[10px] font-bold tracking-widest" style={{ color: '#93C5FD' }}>Advanced Diagnostics</summary>
              <div className="mt-2">{orchControls}</div>
            </details>
          ) : (
            orchControls
          )}
        </section>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #14532d', background: 'rgba(20,83,45,0.12)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#86EFAC' }}>ACTIVE OPERATIONS</span>
            <button type="button" className="rounded px-2 py-1 text-[10px] font-bold" style={{ border: '1px solid #555', color: '#ccc' }} onClick={() => void loadWorkerStatus()} disabled={workerStatusLoading}>STATUS</button>
          </div>
          <p className="mb-2 text-[9px]" style={{ color: '#888' }}>Each control issues a single POST /api/workers/run (no background timers).</p>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {(workerStatus.length ? workerStatus : WORKER_IDS.map(workerId => ({ workerId, lastRun: null as WorkerRunRow | null }))).map(w => (
              <li key={w.workerId} className="rounded border border-white/10 p-2" style={{ color: '#ddd' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[10px]" style={{ color: '#BBF7D0' }}>{w.workerId}</span>
                  <button type="button" className="rounded px-2 py-0.5 text-[9px] font-bold" style={{ background: '#166534', color: '#fff' }} disabled={runBusy !== null} onClick={() => void triggerWorkerRun(w.workerId)}>RUN</button>
                </div>
                <div className="mt-1 text-[9px] opacity-70">
                  last:
                  {' '}
                  {w.lastRun ? `${w.lastRun.ok ? 'ok' : 'fail'} @ ${w.lastRun.created_at?.slice(5, 22)}` : '—'}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid #4c1d95', background: 'rgba(76,29,149,0.12)' }}>
          {uiMode === 'operator' ? (
            <details
              onToggle={e => {
                const open = (e.target as HTMLDetailsElement).open
                setEventsExpanded(open)
                if (open && !events.length && !eventsLoading) void loadEvents()
              }}
            >
              <summary className="cursor-pointer font-bold tracking-widest" style={{ color: '#C4B5FD' }}>
                Activity Stream
                {events.length > 0 && (
                  <span className="ml-2 font-mono text-[9px] font-normal opacity-70">
                    last:
                    {' '}
                    {events.slice(0, 2).map(e => e.type).join(' · ')}
                  </span>
                )}
              </summary>
              <div className="mt-2">{activityInner}</div>
            </details>
          ) : (
            activityInner
          )}
        </section>
      </div>
    </div>
  )
}
