'use client'

import { useEffect, useState } from 'react'

function formatTime(d: Date) {
  return d.toISOString().slice(11, 16) + ' UTC'
}

export function StatusBar() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const timeLabel = formatTime(now)

  return (
    <footer className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-slate-950/70 px-4 py-2.5 text-[11px] uppercase tracking-widest text-slate-400 shadow-[0_-12px_40px_-20px_rgba(56,189,248,0.35)] backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-slate-200 tabular-nums">{timeLabel}</span>
        <span className="hidden sm:inline text-slate-500">|</span>
        <span className="text-slate-400">Legacy demo route</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.2em] text-slate-500">
        <span className="text-slate-300">
          Council seating / sentinel / observer: <span className="text-amber-300">simulated placeholder</span>
        </span>
        <span>Named sections not connected to live providers</span>
        <span>Other panels may use real backend data</span>
        <span className="rounded border border-amber-400/30 bg-amber-400/5 px-2 py-0.5 text-amber-300">
          Demo
        </span>
      </div>
    </footer>
  )
}

