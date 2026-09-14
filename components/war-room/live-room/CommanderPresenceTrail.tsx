'use client'

import { memo } from 'react'

import type { CommanderPresencePhase } from '@/lib/council/live-orchestration/rosterHealth'

const STEPS: Array<Exclude<CommanderPresencePhase, 'idle'>> = ['understanding', 'researching', 'verifying', 'synthesizing']

const LABEL: Record<Exclude<CommanderPresencePhase, 'idle'>, string> = {
  understanding: 'Understanding',
  researching: 'Researching',
  verifying: 'Verifying',
  synthesizing: 'Synthesizing',
}

function stepIndex(phase: CommanderPresencePhase): number {
  if (phase === 'idle') return -1
  return STEPS.indexOf(phase)
}

export const CommanderPresenceTrail = memo(function CommanderPresenceTrail({
  phase,
}: {
  phase: CommanderPresencePhase
}) {
  if (phase === 'idle') return null
  const current = stepIndex(phase)

  return (
    <div
      className="message-fade-in mb-3 flex flex-wrap items-center gap-1.5 px-1"
      data-testid="commander-presence-trail"
      aria-live="polite"
    >
      {STEPS.map((step, index) => {
        const active = index === current
        const done = index < current
        return (
          <span key={step} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span className="text-[8px] text-slate-600">→</span> : null}
            <span
              className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.16em] ${
                active
                  ? 'commander-status-pill border-cyan-400/50 text-cyan-200'
                  : done
                    ? 'border-emerald-400/30 text-emerald-300/80'
                    : 'border-white/10 text-slate-600'
              }`}
            >
              {LABEL[step]}
            </span>
          </span>
        )
      })}
    </div>
  )
})
