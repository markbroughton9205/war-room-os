'use client'

import { memo, useEffect, useState } from 'react'

export type WarRoomOsHeaderProps = {
  systemStatusLine?: string
  missionHint?: string
}

function formatClock(now: Date) {
  return now.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const WarRoomOsHeader = memo(function WarRoomOsHeader({
  systemStatusLine = 'All systems nominal',
  missionHint,
}: WarRoomOsHeaderProps) {
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()))
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header
      className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-emerald-900/50 px-4 py-2.5 sm:px-6"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      data-testid="war-room-os-header"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.42em] text-emerald-400">War Room OS</p>
        <p className="truncate text-[11px] font-semibold tracking-widest text-yellow-200/95">
          Ra&apos;el — Higher Vision Inc
        </p>
      </div>

      <div className="hidden flex-1 flex-col items-center gap-1 sm:flex">
        <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-slate-500">System Status</p>
        <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] tracking-widest text-slate-400">
          <span title="Missing dependency: a connected resource monitor feed.">CPU · Not connected</span>
          <span className="text-emerald-900/80">|</span>
          <span title="Missing dependency: a connected resource monitor feed.">Memory · Not connected</span>
          <span className="text-emerald-900/80">|</span>
          <span title="Missing dependency: a connected network health feed.">Network · Not connected</span>
        </div>
        <p className="max-w-md truncate text-center text-[9px] tracking-wide text-cyan-300/80" title={systemStatusLine}>
          {systemStatusLine}
          {missionHint ? ` · ${missionHint}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <time className="text-[10px] tracking-widest text-slate-300" dateTime={clock}>
          {clock || '—'}
        </time>
        <span
          className="rounded border border-emerald-500/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300"
          style={{ boxShadow: '0 0 12px rgba(0,255,102,0.15)' }}
        >
          Ra&apos;el Operator
        </span>
      </div>
    </header>
  )
})
