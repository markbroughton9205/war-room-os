'use client'

import type { FoundryRuntimeView } from '@/lib/native-builder/foundryMissionRuntimeTypes'

export function FoundryMissionRuntimePanel({
  view,
  advanced,
}: {
  view?: FoundryRuntimeView | null
  advanced?: boolean
}) {
  if (!view || view.state === 'NONE') {
    return (
      <div className="mt-2 rounded border border-white/10 p-2" data-testid="foundry-runtime" aria-label="Mission runtime">
        <p className="text-[9px] uppercase tracking-widest text-slate-500">RUNTIME</p>
        <p className="text-[10px] text-slate-400">No runtime owner</p>
      </div>
    )
  }
  return (
    <div className="mt-2 rounded border border-emerald-400/20 p-2" data-testid="foundry-runtime" aria-label="Mission runtime">
      <p className="text-[9px] uppercase tracking-widest text-emerald-300">RUNTIME</p>
      <p className="text-[10px] text-slate-200" data-testid="foundry-runtime-label">{view.truthfulLabel}</p>
      <p className="text-[10px] text-slate-400">{view.detail}</p>
      {view.nextWakeAt ? <p className="text-[10px] text-slate-400">Next wake: {view.nextWakeAt}{view.wakeReason ? ` · ${view.wakeReason}` : ''}</p> : null}
      <p className="text-[10px] text-slate-500">Recovery count {view.recoveryCount}</p>
      {advanced ? (
        <div data-testid="foundry-runtime-advanced">
          <p className="text-[9px] text-slate-500">runtime {view.runtimeId}</p>
          <p className="text-[9px] text-slate-500">generation {view.runtimeGeneration}</p>
          <p className="text-[9px] text-slate-500">lease {view.leaseId ?? 'none'} owner {view.ownerInstanceId ?? 'none'}</p>
          <p className="text-[9px] text-slate-500">checkpoint {view.lastCheckpointId ?? 'none'}</p>
        </div>
      ) : null}
    </div>
  )
}
