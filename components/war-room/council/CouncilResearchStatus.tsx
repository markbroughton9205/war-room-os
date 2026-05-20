'use client'

import type { ResearchStatus } from '@/lib/council-research/types'

const STEPS: { id: ResearchStatus; label: string }[] = [
  { id: 'gathering_sources', label: 'Gathering sources' },
  { id: 'comparing_sources', label: 'Comparing sources' },
  { id: 'red_team_check', label: 'Red Team checking' },
  { id: 'final_answer_ready', label: 'Final answer ready' },
]

function stepIndex(status: ResearchStatus | null): number {
  if (!status) return -1
  const i = STEPS.findIndex(s => s.id === status)
  return i >= 0 ? i : -1
}

export function CouncilResearchStatus({
  active,
  phase,
  failed,
}: {
  active: boolean
  phase: ResearchStatus | null
  failed?: boolean
}) {
  if (!active && !failed) return null

  const current = stepIndex(phase)
  const doneThrough = phase === 'final_answer_ready' ? STEPS.length : current

  return (
    <div
      className="ml-11 mb-3 rounded border border-cyan-500/20 bg-cyan-950/10 px-3 py-2"
      aria-live="polite"
    >
      <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-200/90">
        {failed ? 'Research failed' : phase === 'final_answer_ready' ? 'Research complete' : 'Researching…'}
      </p>
      <ol className="mt-2 space-y-1">
        {STEPS.map((step, i) => {
          const complete = failed ? i < doneThrough : i < doneThrough || (phase === 'final_answer_ready' && i <= current)
          const currentStep = i === current && phase !== 'final_answer_ready' && !failed
          return (
            <li
              key={step.id}
              className="flex items-center gap-2 text-[10px]"
              style={{
                color: complete ? '#86EFAC' : currentStep ? '#67E8F9' : '#64748b',
              }}
            >
              <span
                className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border text-[8px]"
                style={{
                  borderColor: complete ? 'rgba(134,239,172,0.5)' : currentStep ? 'rgba(103,232,249,0.6)' : '#334155',
                  background: complete ? 'rgba(34,197,94,0.15)' : currentStep ? 'rgba(6,182,212,0.12)' : 'transparent',
                }}
              >
                {complete ? '✓' : currentStep ? '…' : ''}
              </span>
              {step.label}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
