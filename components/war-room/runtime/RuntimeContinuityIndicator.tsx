'use client'

import type { RuntimeContinuityIndicatorMode } from '@/lib/runtime/runtimeStateClient'

const tone: Record<RuntimeContinuityIndicatorMode, { border: string; color: string; bg: string }> = {
  Live: { border: 'rgba(52,211,153,0.45)', color: '#6ee7b7', bg: 'rgba(6,78,59,0.35)' },
  Recovered: { border: 'rgba(96,165,250,0.45)', color: '#93c5fd', bg: 'rgba(30,58,138,0.35)' },
  Historical: { border: 'rgba(251,191,36,0.45)', color: '#fcd34d', bg: 'rgba(69,26,3,0.35)' },
  Refreshing: { border: 'rgba(167,139,250,0.45)', color: '#d8b4fe', bg: 'rgba(46,16,101,0.35)' },
  Unknown: { border: 'rgba(148,163,184,0.35)', color: '#94a3b8', bg: 'rgba(15,23,42,0.45)' },
}

export function RuntimeContinuityIndicator({
  mode,
  lastRecoveredAt,
  recoverBanner,
  persistNote,
}: {
  mode: RuntimeContinuityIndicatorMode
  lastRecoveredAt: string | null
  recoverBanner: boolean
  persistNote?: string | null
}) {
  const t = tone[mode]
  return (
    <div className="space-y-1">
      {recoverBanner ? (
        <div
          className="rounded border px-2 py-1 text-[9px] font-bold tracking-widest"
          style={{ borderColor: t.border, color: t.color, background: t.bg }}
        >
          Recovered previous runtime state (historical until live probes refresh).
        </div>
      ) : null}
      {persistNote?.trim() ? (
        <div
          className="rounded border border-amber-500/35 bg-amber-950/35 px-2 py-1 text-[9px] font-bold tracking-widest text-amber-100/90"
          title="Durable runtime snapshots are unavailable; live provider registry status is still shown when loaded."
        >
          {persistNote}
        </div>
      ) : null}
      <div
        className="inline-flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-[9px] font-bold tracking-widest"
        style={{ borderColor: t.border, color: t.color, background: t.bg }}
        title="Operational snapshots only — no auto-resume or auto-repair."
      >
        <span>Runtime continuity:</span>
        <span>{mode}</span>
        {lastRecoveredAt ? (
          <span className="font-normal normal-case text-white/60">
            last storage read {new Date(lastRecoveredAt).toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  )
}
