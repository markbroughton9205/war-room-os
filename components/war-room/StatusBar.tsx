'use client'

import { useEffect, useState } from 'react'

function formatTime(d: Date) {
  return d.toISOString().slice(11, 19) + ' UTC'
}

export function StatusBar() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const timeLabel = formatTime(now)

  return (
    <footer className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-slate-950/70 px-4 py-2.5 text-[11px] uppercase tracking-widest text-slate-400 shadow-[0_-12px_40px_-20px_rgba(56,189,248,0.35)] backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-slate-200 tabular-nums">{timeLabel}</span>
        <span className="hidden sm:inline text-slate-500">|</span>
        <span className="flex items-center gap-1.5 text-[#d4af37]">
          <span
            className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shadow-[0_0_10px_#22c55e]"
            aria-hidden
          />
          Secure
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.2em] text-slate-500">
        <span className="text-slate-300">
          Lat <span className="text-[#38bdf8]">42ms</span>
        </span>
        <span>Edge · ORD</span>
        <span className="rounded border border-[#d4af37]/25 bg-[#d4af37]/5 px-2 py-0.5 text-[#d4af37]">
          Mock
        </span>
      </div>
    </footer>
  )
}

