'use client'

import { memo, useMemo } from 'react'

import {
  lifecycleLabel,
  listActiveRepairs,
  summarizeSelfRepairHealth,
  type SelfRepairSnapshot,
} from '@/lib/operator/selfRepair'
import { countQueuedUpgrades } from '@/lib/operator/upgradeQueue'
import { countRepairLessons } from '@/lib/operator/repairLessons'

export type SelfRepairPanelProps = {
  repairSnapshot: SelfRepairSnapshot
  openGapCount: number
}

export const SelfRepairPanel = memo(function SelfRepairPanel({
  repairSnapshot,
  openGapCount,
}: SelfRepairPanelProps) {
  const summary = useMemo(
    () =>
      summarizeSelfRepairHealth(
        repairSnapshot,
        openGapCount,
        countQueuedUpgrades(),
        countRepairLessons(),
      ),
    [openGapCount, repairSnapshot],
  )

  const active = useMemo(() => listActiveRepairs(repairSnapshot).slice(0, 8), [repairSnapshot])

  return (
    <section
      className="rounded border border-violet-500/25 bg-black/30 p-3"
      data-testid="self-repair-panel"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-violet-200">
        System Health · Self-Repair Loop
      </p>
      <p className="mt-1 text-[9px] tracking-wide text-slate-500">
        Detect → Propose → Approve → Hand off → Validate → Learn. Session-only; no browser code
        execution.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <HealthStat label="Open issues" value={summary.openIssues} warn={summary.openIssues > 0} />
        <HealthStat label="Approved upgrades" value={summary.approvedUpgrades} />
        <HealthStat label="In progress" value={summary.inProgress} />
        <HealthStat label="Verified" value={summary.verified} ok />
        <HealthStat label="Failed" value={summary.failed} warn={summary.failed > 0} />
        <HealthStat label="Lessons" value={summary.lessons} />
      </div>

      {active.length ? (
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-[9px]">
          {active.map(r => (
            <li key={r.id} className="rounded border border-white/5 bg-black/30 px-2 py-1">
              <span className="text-slate-300">{r.plan.title}</span>
              <span className="ml-2 text-violet-300/80">{lifecycleLabel(r.state)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[9px] text-slate-500">
          No active repair records. Use Prepare Repair Plan on an inbox or self-audit item.
        </p>
      )}
    </section>
  )
})

function HealthStat({
  label,
  value,
  warn,
  ok,
}: {
  label: string
  value: number
  warn?: boolean
  ok?: boolean
}) {
  const color = warn ? '#FCA5A5' : ok ? '#86EFAC' : '#C4B5FD'
  return (
    <div
      className="rounded px-2 py-1.5 text-center"
      style={{ border: '1px solid rgba(139,92,246,0.25)', background: 'rgba(0,0,0,0.35)' }}
    >
      <div className="text-[8px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  )
}
