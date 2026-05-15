'use client'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type DiagnosticPanelState = {
  active: boolean
  turnIndex: number
  order: CouncilOrchestrationFamily[]
  hold: boolean
}

export function DiagnosticSessionPanel({ state }: { state: DiagnosticPanelState | null }) {
  if (!state?.active) {
    return <p className="text-xs text-white/50">No active diagnostic session.</p>
  }

  const label = (f: CouncilOrchestrationFamily) =>
    f === 'red_team' ? 'Red Team' : f === 'bridge_architect' ? 'Bridge Architect' : f.replace('_', ' ')

  const current = state.order[state.turnIndex]

  return (
    <div className="rounded-lg border border-emerald-500/25 bg-black/40 p-3 text-sm text-white/90">
      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300/90">Sequential diagnostic</div>
      <div className="mt-2 grid gap-1 text-xs text-white/75">
        <div>
          <span className="text-white/50">Mode:</span> active
        </div>
        <div>
          <span className="text-white/50">Current speaker:</span>{' '}
          {current ? <span className="text-emerald-200">{label(current)}</span> : '—'}
        </div>
        <div>
          <span className="text-white/50">Progress:</span>{' '}
          {Math.min(state.turnIndex + 1, state.order.length)} / {state.order.length}
        </div>
        <div>
          <span className="text-white/50">Queue:</span>{' '}
          <span className="text-white/80">{state.order.map(label).join(' → ')}</span>
        </div>
        <div>
          <span className="text-white/50">HOLD:</span>{' '}
          <span className={state.hold ? 'text-amber-300' : 'text-white/60'}>{state.hold ? 'yes' : 'no'}</span>
        </div>
      </div>
    </div>
  )
}
