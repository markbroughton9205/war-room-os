'use client'

import { useEffect, useState } from 'react'

import type { SentinelMetricState, SentinelStatus } from '@/lib/mockCouncilData'
import { MOCK_SENTINEL_STATUS } from '@/lib/mockCouncilData'

// All metrics rendered here come from `MOCK_SENTINEL_STATUS` (lib/mockCouncilData.ts)
// — simulated placeholder values, not live readings. Badges are styled neutral
// slate and suffixed "sim": no green/healthy/critical signal coloring without
// runtime evidence.
const STATE_BADGE: Record<SentinelMetricState, string> = {
  nominal: 'border-dashed border-slate-500/50 bg-slate-950/60 text-slate-400',
  elevated: 'border-dashed border-slate-500/50 bg-slate-950/60 text-slate-400',
  critical: 'border-dashed border-slate-500/50 bg-slate-950/60 text-slate-400',
}

const ROWS: { key: keyof SentinelStatus; label: string }[] = [
  { key: 'securityStatus', label: 'Security' },
  { key: 'hallucinationWatch', label: 'Hallucination' },
  { key: 'missionDriftStatus', label: 'Mission drift' },
  { key: 'dataIntegrity', label: 'Data integrity' },
  { key: 'costWarning', label: 'Cost' },
  { key: 'apiHealth', label: 'API health' },
  { key: 'privacyRisk', label: 'Privacy risk' },
]

export function SentinelStatusPanel({
  sentinel = MOCK_SENTINEL_STATUS,
  className = '',
}: {
  sentinel?: SentinelStatus
  className?: string
}) {
  const [feedHint, setFeedHint] = useState('Static seed / not live')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/red-sentinel/status', { cache: 'no-store' })
        if (!res.ok) throw new Error('status failed')
        await res.json()
        if (!cancelled) setFeedHint('Red Sentinel API reachable · static seed metrics')
      } catch {
        if (!cancelled) setFeedHint('Static seed / not live')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section
      className={[
        'rounded-2xl border border-[#00ff41]/20 bg-black/50 p-4 font-mono text-[11px] text-slate-300 shadow-[0_0_0_1px_rgba(255,215,0,0.06),0_0_32px_rgba(0,255,65,0.08)] backdrop-blur-md',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Sentinel status"
    >
      <header className="mb-3 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.35em] text-[#FFD700]">Sentinel</h2>
        <span className="max-w-[55%] text-right text-[9px] uppercase tracking-wide text-[#00ff41]/70">{feedHint}</span>
      </header>
      <div className="grid gap-2 sm:grid-cols-2">
        {ROWS.map(({ key, label }) => {
          const value = sentinel[key]
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2"
            >
              <span className="text-[10px] text-slate-500">{label}</span>
              <span
                className={[
                  'rounded border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                  STATE_BADGE[value],
                ].join(' ')}
              >
                {value} · sim
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
