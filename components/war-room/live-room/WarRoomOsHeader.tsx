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

/**
 * `systemStatusLine`/`missionHint` are intentionally accepted but unused: the verbose
 * CPU/Memory/Network System Status block was removed from the header per Commander
 * correction (2026-08-05) — that detail belongs in System Health / Runtime Details / the
 * compact WarRoomStatusSigilButton indicator, not a permanent header banner. Kept as
 * optional props so call sites don't need to change.
 */
export const WarRoomOsHeader = memo(function WarRoomOsHeader(props: WarRoomOsHeaderProps) {
  // Accepted for call-site compatibility only — see comment above. Referenced (no-op) so the
  // linter doesn't flag them as unused; the props themselves are intentionally not rendered.
  void props.systemStatusLine
  void props.missionHint
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
