'use client'

import { memo } from 'react'
import type { OperatorFinancialMetric } from '@/lib/operator/deckTypes'

function tone(label: string): string {
  if (label === 'UNAVAILABLE') return 'text-slate-500 border-white/10'
  if (label === 'MANUAL_LOGGED') return 'text-emerald-200 border-emerald-300/30'
  if (label === 'SOURCE_BACKED') return 'text-sky-200 border-sky-300/30'
  return 'text-yellow-200 border-yellow-300/30'
}

export const FinancialTelemetryMini = memo(function FinancialTelemetryMini({ metrics }: { metrics: OperatorFinancialMetric[] }) {
  return (
    <section className="rounded border border-emerald-500/20 bg-emerald-500/[0.035] p-3">
      <div className="mb-3">
        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-300">Live Financial Telemetry</div>
        <p className="mt-1 text-[10px] text-slate-500">Manual logged or source-backed money only. Missing data stays unavailable.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(metric => (
          <article key={metric.key} className="rounded border border-white/10 bg-black/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{metric.label}</div>
              <span className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${tone(metric.truthLabel)}`}>
                {metric.truthLabel.replace(/_/g, ' ')}
              </span>
            </div>
            <div className={metric.truthLabel === 'UNAVAILABLE' ? 'mt-2 font-mono text-lg text-slate-500' : 'mt-2 font-mono text-lg text-emerald-50'}>
              {metric.value}
            </div>
            {metric.progress == null ? (
              <div className="mt-3 h-1.5 rounded bg-white/10">
                <div className="h-full w-0 rounded bg-slate-700" />
              </div>
            ) : (
              <div className="mt-3 h-1.5 overflow-hidden rounded bg-white/10">
                <div className="h-full rounded bg-emerald-300" style={{ width: `${metric.progress}%` }} />
              </div>
            )}
            <div className="mt-2 text-[9px] leading-relaxed text-slate-500">
              {metric.source ?? 'No verified entry has been recorded for this metric yet.'}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
})
