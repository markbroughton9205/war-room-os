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

export function SystemStatusMatrix({ rows }: { rows: SubsystemRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-white/50">No subsystem rows.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs text-white/85">
        <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/50">
          <tr>
            <th className="px-3 py-2">Subsystem</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Truth</th>
            <th className="px-3 py-2">Risk</th>
            <th className="px-3 py-2">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-white/10 odd:bg-black/20">
              <td className="px-3 py-2 font-medium text-white/90">{r.label}</td>
              <td className={`px-3 py-2 font-semibold ${statusTone(r.status)}`}>{r.status}</td>
              <td className="px-3 py-2 text-white/65">{r.truthLevel}</td>
              <td className="px-3 py-2 text-white/65">{r.risk}</td>
              <td className="max-w-md px-3 py-2 text-white/70">{r.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
