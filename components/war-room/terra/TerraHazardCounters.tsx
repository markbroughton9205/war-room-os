'use client'

import { formatHazardUpdated, type TerraHazardCounter } from '@/lib/terra/hazardStatus'

const HEALTH_CLASS: Record<TerraHazardCounter['health'], string> = {
  HEALTHY: 'text-emerald-400',
  STALE: 'text-amber-300',
  PARTIAL: 'text-cyan-200',
  UNAVAILABLE: 'text-slate-400',
  AUTH_REQUIRED: 'text-cyan-200',
  RATE_LIMITED: 'text-amber-300',
}

export function TerraHazardCounters({ counters, nowMs }: { counters: TerraHazardCounter[]; nowMs?: number }) {
  return (
    <div className="pointer-events-auto group/hazards relative max-w-[min(40rem,46vw)]" data-testid="terra-hazard-counters">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[9px] backdrop-blur-md">
        {counters.slice(0, 4).map(item => (
          <span key={item.id} className="whitespace-nowrap" title={`${item.provider} · ${item.coverage}`}>
            <span className="text-slate-500">{item.label} </span>
            <span className={`font-mono font-bold ${HEALTH_CLASS[item.health]}`}>{item.displayValue}</span>
          </span>
        ))}
        {counters.length > 4 ? <span className="text-cyan-300/80">+{counters.length - 4}</span> : null}
      </div>
      <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-max -translate-x-1/2 rounded-lg border border-cyan-400/20 bg-black/90 px-3 py-2 text-[10px] shadow-xl group-hover/hazards:block group-focus-within/hazards:block">
        {counters.map(item => (
          <p key={item.id} className="whitespace-nowrap">
            <span className="text-slate-500">{item.label} </span>
            <span className={`font-mono font-bold ${HEALTH_CLASS[item.health]}`}>{item.displayValue}</span>
            <span className="text-slate-500">
              {' '}{item.provider} · {item.health === 'PARTIAL' ? 'PARTIAL' : item.freshness} · {formatHazardUpdated(item.lastUpdated, nowMs)}
            </span>
          </p>
        ))}
      </div>
    </div>
  )
}
