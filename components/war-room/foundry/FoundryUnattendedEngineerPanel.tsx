'use client'

import type { FoundryUnattendedView } from '@/lib/native-builder/foundryUnattendedTypes'

export function FoundryUnattendedEngineerPanel({
  view,
  graphId,
  goal,
  contractGeneration,
  budgetState,
  onRefresh,
}: {
  view?: FoundryUnattendedView | null
  graphId?: string
  goal?: string
  contractGeneration?: string | null
  budgetState?: string | null
  onRefresh?: () => void
}) {
  async function post(action: string) {
    await fetch('/api/foundry/command-center', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, graphId, commanderConfirmed: true }),
    })
    onRefresh?.()
  }

  if (!view || view.status === 'NONE') {
    return (
      <div className="mt-2 rounded border border-white/10 p-2" data-testid="foundry-auto-engineer" aria-label="Auto Engineer">
        <p className="text-[9px] uppercase tracking-widest text-slate-500">AUTO ENGINEER</p>
        <p className="text-[10px] text-slate-400">BOUNDED COMMANDER-AUTHORIZED UNATTENDED ENGINEERING</p>
        <p className="text-[10px] text-slate-500">Not authorized. Mission approval is not unattended permission.</p>
        {graphId ? (
          <button
            type="button"
            className="mt-1 text-[10px] uppercase tracking-widest text-emerald-300"
            data-testid="foundry-start-auto-engineer"
            onClick={() => {
              const confirmed = window.confirm(
                `START AUTO ENGINEER\nThis is bounded Commander-authorized unattended engineering, not unlimited autonomy.\nMission: ${goal ?? graphId}\nContract generation: ${contractGeneration ?? 'current'}\nResource budget: ${budgetState ?? 'current'}\nAllowed: read, search, in-scope write via Tool Broker, test, typecheck/build if budgeted, L0/L1/L2, verify, sleep/wake.\nAlways Commander: contract expansion, L3, reapproval, budget increase, commit, push, deploy, secrets, destructive git.\nConfirm?`,
              )
              if (!confirmed) return
              void post('start-auto-engineer')
            }}
          >
            START AUTO ENGINEER
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mt-2 rounded border border-cyan-400/20 p-2" data-testid="foundry-auto-engineer" aria-label="Auto Engineer">
      <p className="text-[9px] uppercase tracking-widest text-cyan-300">AUTO ENGINEER</p>
      <p className="text-[10px] text-slate-200" data-testid="foundry-auto-engineer-label">{view.truthfulLabel}</p>
      <p className="text-[10px] text-slate-400">{view.detail}</p>
      {view.authorizedAt ? <p className="text-[10px] text-slate-500">Authorized {view.authorizedAt}</p> : null}
      {view.lastActivityAt ? <p className="text-[10px] text-slate-500">Last activity {view.lastActivityAt}</p> : null}
      {view.currentTaskId ? <p className="text-[10px] text-slate-500">Current task {view.currentTaskId}</p> : null}
      {view.nextWakeAt ? <p className="text-[10px] text-slate-500">Next wake {view.nextWakeAt}</p> : null}
      {view.budgetState ? <p className="text-[10px] text-slate-500">Budget {view.budgetState}</p> : null}
      {view.replanState ? <p className="text-[10px] text-slate-500">Replan {view.replanState}</p> : null}
      {graphId && view.status !== 'CANCELLED' && view.status !== 'COMPLETE' ? (
        <button
          type="button"
          className="mt-1 text-[10px] uppercase tracking-widest text-amber-300"
          data-testid="foundry-stop-auto-engineer"
          onClick={() => void post('stop-auto-engineer')}
        >
          STOP AUTO ENGINEER
        </button>
      ) : null}
    </div>
  )
}
