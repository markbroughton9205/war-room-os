'use client'

import type { NearbyGodsEyeSnapshot } from '@/lib/terra/godsEye/nearbyGodsEye'

const STATE_CLASS: Record<string, string> = {
  COVERED: 'text-emerald-400',
  EMPTY: 'text-slate-400',
  NO_COVERAGE: 'text-amber-200',
  PARTIAL: 'text-amber-300',
  AUTH_REQUIRED: 'text-cyan-200',
  PROVIDER_AUTH_REQUIRED: 'text-amber-300',
  NONE_WITHIN_RADIUS: 'text-amber-200',
  UNAVAILABLE: 'text-rose-400',
}

export function TerraNearbyGodsEye({ snapshot }: { snapshot: NearbyGodsEyeSnapshot | null }) {
  if (!snapshot) return null
  return (
    <div className="pointer-events-auto rounded border border-white/10 bg-black/40 p-2" data-testid="terra-nearby-gods-eye">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Nearby</p>
      <p className="mt-0.5 text-[10px] text-slate-500">{snapshot.originLabel} · covered layers only</p>
      {snapshot.rows.length === 0 ? (
        <p className="mt-1 text-[10px] text-slate-600">No covered Nearby layers at this location.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {snapshot.rows.map(row => (
            <li key={row.id} className="flex items-start justify-between gap-2" title={row.detail}>
              <span className="text-[10px] text-slate-300">{row.label}</span>
              <span className={`font-mono text-[9px] uppercase ${STATE_CLASS[row.state] ?? 'text-slate-400'}`}>
                {row.state === 'EMPTY' ? `0` : row.state === 'COVERED' ? row.count : row.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
