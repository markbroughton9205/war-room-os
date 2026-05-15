'use client'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DiagnosticIntentMode } from '@/lib/council/diagnosticMode'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

export type DiagnosticPanelState = {
  active: boolean
  turnIndex: number
  order: CouncilOrchestrationFamily[]
  hold: boolean
  intentMode?: DiagnosticIntentMode
  holdReason?: string
  outcomes?: { family: CouncilOrchestrationFamily; runtime: ProviderFamilyOutcomeStatus }[]
}

export function DiagnosticSessionPanel({
  state,
  onReleaseHold,
}: {
  state: DiagnosticPanelState | null
  /** When Red Team HOLD is active, Ra'el (operator) can resume the queue without waiting for timeout. */
  onReleaseHold?: () => void
}) {
  if (!state?.active) {
    return <p className="text-xs text-white/50">No active diagnostic session.</p>
  }

  const label = (f: CouncilOrchestrationFamily) =>
    f === 'red_team' ? 'Red Team' : f === 'bridge_architect' ? 'Bridge Architect' : f.replace('_', ' ')

  const current = state.order[state.turnIndex]
  const modeLabel =
    state.intentMode === 'runtime_audit'
      ? 'Runtime audit'
      : state.intentMode === 'repair_review'
        ? 'Repair review'
        : state.intentMode === 'sequential_diagnostics'
          ? 'Sequential diagnostics'
          : 'Sequential diagnostic'

  const outcomes = state.outcomes ?? []
  const completed = outcomes.filter(o => o.runtime === 'RESPONDED').map(o => label(o.family))
  const failed = outcomes.filter(o => o.runtime === 'FAILED' || o.runtime === 'TIMED_OUT').map(o => label(o.family))
  const skipped = outcomes.filter(o => o.runtime === 'SKIPPED').map(o => label(o.family))
  const pending = state.order.slice(state.turnIndex + 1).map(label)

  return (
    <div className="rounded-lg border border-emerald-500/25 bg-black/40 p-3 text-sm text-white/90">
      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300/90">Sequential diagnostic</div>
      {state.hold && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-950/35 px-2 py-2 text-xs text-amber-100">
          <div className="font-semibold text-amber-200">Red Team HOLD — awaiting Ra&apos;el</div>
          <div className="mt-1 text-amber-100/85">
            The queue will auto-resume after 60s with a system line, or you can continue now.
          </div>
          {onReleaseHold ? (
            <button
              type="button"
              className="mt-2 rounded border border-amber-400/50 px-2 py-1 text-[11px] font-semibold text-amber-50 hover:bg-amber-900/40"
              onClick={onReleaseHold}
            >
              Continue diagnostics
            </button>
          ) : null}
        </div>
      )}
      <div className="mt-2 grid gap-1 text-xs text-white/75">
        <div>
          <span className="text-white/50">Mode:</span> {modeLabel}
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
        {completed.length > 0 && (
          <div>
            <span className="text-white/50">Completed:</span> <span className="text-emerald-200/90">{completed.join(', ')}</span>
          </div>
        )}
        {failed.length > 0 && (
          <div>
            <span className="text-white/50">Failed / timed out:</span> <span className="text-rose-200/90">{failed.join(', ')}</span>
          </div>
        )}
        {skipped.length > 0 && (
          <div>
            <span className="text-white/50">Skipped:</span> <span className="text-white/60">{skipped.join(', ')}</span>
          </div>
        )}
        {pending.length > 0 && (
          <div>
            <span className="text-white/50">Pending:</span> <span className="text-white/70">{pending.join(' → ')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
