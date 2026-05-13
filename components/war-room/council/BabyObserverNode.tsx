import type { BabyObserver } from '@/lib/mockCouncilData'
import { MOCK_BABY_OBSERVER } from '@/lib/mockCouncilData'

export function BabyObserverNode({
  observer = MOCK_BABY_OBSERVER,
  className = '',
}: {
  observer?: BabyObserver
  className?: string
}) {
  return (
    <aside
      className={[
        'rounded-xl border border-sky-500/20 bg-black/45 p-3 font-mono text-[10px] text-slate-300 shadow-[0_0_24px_rgba(56,189,248,0.12),inset_0_0_20px_rgba(255,215,0,0.04)] backdrop-blur-md',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Baby observer"
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.3em] text-sky-300/90">Baby observer</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="flex justify-between gap-2 border-b border-white/5 pb-1">
          <dt className="text-slate-500">Patterns</dt>
          <dd className="font-semibold text-white">{observer.patternsDetected}</dd>
        </div>
        <div className="flex justify-between gap-2 border-b border-white/5 pb-1">
          <dt className="text-slate-500">Contradictions</dt>
          <dd className="font-semibold text-[#FFD700]">{observer.contradictionsNoticed}</dd>
        </div>
        <div className="flex justify-between gap-2 border-b border-white/5 pb-1">
          <dt className="text-slate-500">Drift warns</dt>
          <dd className="text-sky-200">{observer.familyDriftWarnings}</dd>
        </div>
        <div className="flex justify-between gap-2 border-b border-white/5 pb-1">
          <dt className="text-slate-500">Prefs</dt>
          <dd>{observer.repeatedUserPreferences}</dd>
        </div>
        <div className="col-span-2 flex justify-between gap-2 border-b border-white/5 pb-1">
          <dt className="text-slate-500">Memory</dt>
          <dd className="truncate text-right text-[#00ff41]/85">{observer.memoryGrowth}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Loops</dt>
          <dd>{observer.unresolvedLoops}</dd>
        </div>
      </dl>
      <p className="mt-2 line-clamp-3 border-t border-white/5 pt-2 text-[9px] leading-relaxed text-slate-400">
        {observer.learningSummary}
      </p>
    </aside>
  )
}
