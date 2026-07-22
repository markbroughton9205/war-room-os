import type { RuntimeStatePresentation } from '@/lib/runtime/runtimeStatePresentation'

const TONES: Record<RuntimeStatePresentation['state'], string> = {
  loading: 'border-cyan-400/25 bg-cyan-400/5 text-cyan-100',
  ready: 'border-emerald-400/25 bg-emerald-400/5 text-emerald-100',
  healthy_empty: 'border-emerald-400/20 bg-emerald-400/[0.03] text-slate-300',
  waiting_for_first_run: 'border-yellow-400/25 bg-yellow-400/5 text-yellow-100',
  not_configured: 'border-amber-400/25 bg-amber-400/5 text-amber-100',
  unavailable: 'border-slate-400/25 bg-slate-400/5 text-slate-300',
  failed: 'border-red-400/30 bg-red-400/10 text-red-100',
  stale: 'border-orange-400/25 bg-orange-400/5 text-orange-100',
  unknown: 'border-violet-400/25 bg-violet-400/5 text-violet-100',
}

function timeLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : null
}

export function RuntimeStateNotice({ presentation, compact = false }: { presentation: RuntimeStatePresentation; compact?: boolean }) {
  const updated = timeLabel(presentation.lastUpdated)
  return (
    <div className={`rounded border ${compact ? 'p-2 text-[10px]' : 'p-3 text-xs'} ${TONES[presentation.state]}`} role={presentation.state === 'failed' ? 'alert' : 'status'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold uppercase tracking-widest">{presentation.label}</span>
        {presentation.reasonCode ? <span className="text-[8px] uppercase tracking-widest opacity-60">{presentation.reasonCode}</span> : null}
      </div>
      <p className="mt-1 leading-relaxed opacity-90">{presentation.explanation}</p>
      {updated ? <p className="mt-1 text-[9px] opacity-60">Last updated: {updated}</p> : null}
      {presentation.nextAction ? <p className="mt-1 text-[9px] opacity-75">Next step: {presentation.nextAction}</p> : null}
    </div>
  )
}
