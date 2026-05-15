'use client'

import type { SubsystemRow } from '@/lib/runtime/runtimeIntegrityTypes'

function statusTone(s: SubsystemRow['status']): string {
  switch (s) {
    case 'HEALTHY':
      return 'text-emerald-300'
    case 'DEGRADED':
    case 'CONFIGURED_ONLY':
      return 'text-amber-200'
    case 'FAILING':
    case 'UNWIRED':
      return 'text-rose-300'
    case 'MOCK':
      return 'text-violet-300'
    default:
      return 'text-white/70'
  }
}

export function SubsystemHealthCard({ row }: { row: SubsystemRow }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/35 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-white/90">{row.label}</div>
        <div className={`text-xs font-semibold uppercase ${statusTone(row.status)}`}>{row.status}</div>
      </div>
      <div className="mt-1 text-[11px] text-white/45">Truth: {row.truthLevel}</div>
      <p className="mt-2 text-xs leading-snug text-white/70">{row.evidence}</p>
      <p className="mt-2 text-xs text-emerald-200/90">{row.recommendation}</p>
    </div>
  )
}
