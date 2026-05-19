'use client'

import { memo } from 'react'
import type { OperatorAction } from '@/lib/operator/deckTypes'

function badgeTone(value: string): string {
  if (/source|manual|approved|completed/i.test(value)) return 'border-emerald-300/30 text-emerald-200'
  if (/approval|required|proposed|pending/i.test(value)) return 'border-yellow-300/30 text-yellow-200'
  if (/unavailable|skipped|blocked/i.test(value)) return 'border-red-300/30 text-red-200'
  return 'border-white/15 text-slate-300'
}

function TruthBadge({ value }: { value: string }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badgeTone(value)}`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

export const ActionQueueMini = memo(function ActionQueueMini({
  actions,
  loading,
  onComplete,
  onSkip,
  onRequestBetterQueue,
}: {
  actions: OperatorAction[]
  loading: boolean
  onComplete: (action: OperatorAction) => void
  onSkip: (action: OperatorAction) => void
  onRequestBetterQueue: () => void
}) {
  return (
    <section className="rounded border border-yellow-500/20 bg-yellow-500/[0.04] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.28em] text-yellow-300">Today&apos;s Action Queue</div>
          <p className="mt-1 text-[10px] text-slate-500">2-4 source-backed or proposed actions. Empty means no truthful candidate exists.</p>
        </div>
        <button
          type="button"
          onClick={onRequestBetterQueue}
          disabled={loading}
          className="rounded border border-yellow-300/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-yellow-100 disabled:opacity-50"
        >
          {loading ? 'Requesting' : 'Request Better Queue'}
        </button>
      </div>

      {actions.length ? (
        <div className="grid gap-2 lg:grid-cols-2">
          {actions.slice(0, 4).map(action => (
            <article key={action.id} className="rounded border border-white/10 bg-black/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100">{action.title}</h3>
                  <p className="mt-1 text-[10px] text-slate-500">{action.linkedMissionTitle}</p>
                </div>
                <TruthBadge value={action.truthLabel} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-300 sm:grid-cols-4">
                <span className="rounded border border-white/10 px-2 py-1">Reward: {action.estimatedPayLabel}</span>
                <span className="rounded border border-white/10 px-2 py-1">Time: {action.estimatedTimeLabel}</span>
                <span className="rounded border border-white/10 px-2 py-1">Approval: {action.approvalState.replace(/_/g, ' ')}</span>
                <span className="rounded border border-white/10 px-2 py-1">Conf: {action.confidence}%</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TruthBadge value={action.approvalState} />
                <span className="text-[9px] uppercase tracking-widest text-slate-600">Created {new Date(action.createdAt).toLocaleString()}</span>
                {action.optionalLink ? (
                  <a href={action.optionalLink} target="_blank" rel="noreferrer" className="text-[9px] uppercase tracking-widest text-sky-300 underline underline-offset-2">Open Source</a>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onComplete(action)}
                  className="rounded border border-emerald-300/35 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200"
                >
                  Complete &amp; Log
                </button>
                <button
                  type="button"
                  onClick={() => onSkip(action)}
                  className="rounded border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300"
                >
                  Skip
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded border border-white/10 bg-black/25 p-3 text-xs text-slate-500">No source-backed actions yet.</div>
      )}
    </section>
  )
})
