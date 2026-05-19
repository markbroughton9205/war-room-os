'use client'

import { memo } from 'react'
import type { OperatorMissionStatus } from '@/lib/operator/deckTypes'

function statusColor(status: OperatorMissionStatus['status']): string {
  if (status === 'ACTIVE' || status === 'COMPLETE') return 'text-emerald-200 border-emerald-300/30'
  if (status === 'AT_TRIGGER') return 'text-yellow-200 border-yellow-300/30'
  if (status === 'BLOCKED') return 'text-red-200 border-red-300/30'
  return 'text-slate-300 border-white/15'
}

export const MissionStatusStrip = memo(function MissionStatusStrip({ missions }: { missions: OperatorMissionStatus[] }) {
  return (
    <section className="rounded border border-sky-500/20 bg-sky-500/[0.035] p-3">
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-sky-300">Mission Status Overview</div>
      <div className="grid gap-2 md:grid-cols-5">
        {missions.map(mission => (
          <article key={mission.id} className="rounded border border-white/10 bg-black/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-100">{mission.title}</h3>
              <span className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${statusColor(mission.status)}`}>
                {mission.status.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10">
              <div className="h-full rounded bg-sky-300" style={{ width: `${mission.progress}%` }} />
            </div>
            <div className="mt-2 space-y-1 text-[9px] text-slate-500">
              <div>Metric: {mission.keyMetric}</div>
              <div>Momentum: {mission.momentum}</div>
              <div>Trigger: {mission.triggerCondition}</div>
              <div>Approval: {mission.approvalState.replace(/_/g, ' ')}</div>
              <div>Updated: {new Date(mission.lastUpdated).toLocaleString()}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
})
