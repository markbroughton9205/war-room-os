'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SubsystemState } from '@/lib/council/subsystems/types'

const DOT: Record<string, string> = { AVAILABLE: 'bg-emerald-400', DEGRADED: 'bg-amber-400', UNAVAILABLE: 'bg-red-500' }

/** What Council can actually reach in Terra, Terra World and Higher Vision Studios, from live read-only probes. */
export function CouncilSubsystemsPanel() {
  const [states, setStates] = useState<SubsystemState[] | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/council/subsystems', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json() as { subsystems?: SubsystemState[] }
      if (Array.isArray(j.subsystems)) setStates(j.subsystems)
    } catch { /* optional panel */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <section className="mt-2 rounded-lg border border-violet-500/25 px-3 py-2" style={{ background: 'rgba(10,0,16,0.45)' }} data-testid="council-subsystems-panel" aria-label="Connected systems">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-violet-300">Connected systems</p>
        <div className="flex items-center gap-2">
          {(states ?? []).map(s => (
            <span key={s.id} className="flex items-center gap-1 text-[9px] text-slate-300" data-testid={`council-subsystem-chip-${s.id}`} data-status={s.status} title={s.summary}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[s.status] ?? 'bg-slate-500'}`} />
              {s.label}
            </span>
          ))}
          <button type="button" className="rounded border border-violet-400/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-200 hover:bg-violet-400/10"
            onClick={() => { setOpen(o => !o); if (!open) void load() }} data-testid="council-subsystems-toggle">
            {open ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-2 space-y-2" data-testid="council-subsystems-details">
          {loading && !states ? <p className="text-[10px] text-slate-500">Probing…</p> : null}
          {(states ?? []).map(s => (
            <div key={s.id} className="rounded border border-violet-900/40 px-2 py-1.5">
              <p className="text-[10px] font-semibold text-violet-100">{s.label} <span className="text-slate-400">· {s.status}</span></p>
              <p className="text-[9px] text-slate-400">{s.summary}</p>
              <ul className="mt-1 space-y-0.5">
                {s.capabilities.map(c => (
                  <li key={c.id} className="text-[9px] text-slate-300" data-testid="council-subsystem-capability" data-status={c.status}>
                    <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${DOT[c.status] ?? 'bg-slate-500'}`} />
                    {c.label} — {c.status.toLowerCase()}: {c.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[8px] text-slate-500">Not exposed to Council: {s.notExposed.join('; ')}.</p>
            </div>
          ))}
          <button type="button" className="rounded border border-violet-400/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-200 hover:bg-violet-400/10"
            onClick={() => void load()} disabled={loading} data-testid="council-subsystems-refresh">
            {loading ? 'Probing…' : 'Re-probe'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
