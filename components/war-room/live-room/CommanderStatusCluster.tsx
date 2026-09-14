'use client'

import { memo } from 'react'

import type { CommanderStatusPill, CommanderStatusTone } from '@/lib/council/live-orchestration/rosterHealth'

const TONE_GLOW: Record<CommanderStatusTone, string> = {
  nominal: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.95)]',
  active: 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.95)]',
  degraded: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]',
  offline: 'bg-slate-500 shadow-none',
}

const TONE_TEXT: Record<CommanderStatusTone, string> = {
  nominal: 'text-emerald-300',
  active: 'text-cyan-300',
  degraded: 'text-amber-200',
  offline: 'text-slate-500',
}

const GLYPH: Record<CommanderStatusPill['id'], string> = {
  council: '⌬',
  terra: '◎',
  intelligence: '✧',
  systems: '▣',
}

export const CommanderStatusCluster = memo(function CommanderStatusCluster({
  pills,
}: {
  pills: CommanderStatusPill[]
}) {
  const spoken = pills.map(pill => `${pill.kicker} ${pill.label}`).join('. ')
  return (
    <div
      className="commander-status-cluster inline-flex items-center gap-0 rounded-full border border-emerald-400/20 bg-[linear-gradient(180deg,rgba(2,18,22,0.72),rgba(0,8,12,0.55))] px-1.5 py-1 shadow-[0_0_22px_rgba(16,185,129,0.12),inset_0_0_14px_rgba(52,211,153,0.08)] backdrop-blur-md"
      data-testid="commander-status-cluster"
      role="status"
      aria-label={spoken || 'War Room system state'}
    >
      {pills.map((pill, index) => (
        <span key={pill.id} className="inline-flex items-center">
          {index > 0 ? (
            <span className="mx-1 h-px w-3 bg-gradient-to-r from-emerald-400/10 via-cyan-400/35 to-emerald-400/10" aria-hidden />
          ) : null}
          <span
            className="commander-status-node commander-status-pill inline-flex flex-col items-center justify-center px-1.5"
            title={`${pill.kicker}: ${pill.label}`}
          >
            <span className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_GLOW[pill.tone]}`} aria-hidden />
              <span className={`text-[11px] leading-none ${TONE_TEXT[pill.tone]}`} aria-hidden>
                {GLYPH[pill.id]}
              </span>
            </span>
            <span className={`mt-0.5 text-[7px] font-bold uppercase tracking-[0.18em] ${TONE_TEXT[pill.tone]}`}>
              {pill.label}
            </span>
          </span>
        </span>
      ))}
    </div>
  )
})
