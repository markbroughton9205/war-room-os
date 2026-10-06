'use client'

import type { FlightMonitorFilter } from '@/lib/terra/flightIntelligence/monitor'
import type { ProviderHealthState, TerraAircraftTruth } from '@/lib/terra/flightIntelligence/types'

const FILTERS: FlightMonitorFilter[] = ['ALL', 'WATCHED', 'MILITARY', 'STRATEGIC', 'GOVERNMENT', 'COMMERCIAL', 'CARGO', 'SPECIAL_MISSION']

export function TerraFlightMonitor({
  aircraft,
  providers,
  coverage,
  filter,
  onFilter,
  selectedKey,
  onSelect,
  onFocus,
  onFollow,
  following,
  onGodsEye,
  onWatch,
}: {
  aircraft: readonly TerraAircraftTruth[]
  providers: readonly ProviderHealthState[]
  coverage: string
  filter: FlightMonitorFilter
  onFilter: (filter: FlightMonitorFilter) => void
  selectedKey: string | null
  onSelect: (key: string) => void
  onFocus: (key: string) => void
  onFollow: (key: string) => void
  following: boolean
  onGodsEye: (key: string) => void
  onWatch: (key: string) => void
}) {
  return (
    <section className="w-[min(22rem,86vw)] text-slate-200" data-testid="terra-flight-monitor">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">Flight Monitor</p>
      <p className="mt-1 font-mono text-[10px] text-slate-400">coverage {coverage}</p>
      <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-slate-400">
        {providers.map(provider => (
          <li key={provider.provider} data-testid={`flight-provider-${provider.provider}`}>
            {provider.provider} {provider.state} {provider.observationCount}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        {FILTERS.map(item => (
          <button key={item} type="button" onClick={() => onFilter(item)} className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${filter === item ? 'border-cyan-300/50 text-cyan-200' : 'border-white/15 text-slate-400'}`}>
            {item.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
      {coverage === 'NO_COVERAGE' ? <p className="mt-2 text-[10px] text-amber-200">NO_COVERAGE</p> : null}
      <ul className="mt-2 max-h-64 space-y-1 overflow-auto">
        {aircraft.slice(0, 40).map(item => (
          <li key={item.identity.key} className={`rounded border px-2 py-1 ${selectedKey === item.identity.key ? 'border-cyan-300/50' : 'border-white/10'}`}>
            <button type="button" onClick={() => onSelect(item.identity.key)} className="block w-full text-left">
              <span className="text-[11px] text-slate-100">{item.classification.label ?? item.primary?.callsign ?? item.identity.icaoHex ?? item.identity.key}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                {item.identity.icaoHex ?? 'UNKNOWN'} {item.primary?.registration ?? ''} {item.freshness} {item.primary?.provider ?? 'none'} +{item.alternateSourceCount}
              </span>
            </button>
            <div className="mt-1 flex flex-wrap gap-1">
              <button type="button" onClick={() => onFocus(item.identity.key)} className="rounded border border-white/15 px-1 py-0.5 text-[9px] uppercase tracking-widest text-slate-300">Focus</button>
              <button type="button" onClick={() => onFollow(item.identity.key)} className="rounded border border-white/15 px-1 py-0.5 text-[9px] uppercase tracking-widest text-slate-300">{following && selectedKey === item.identity.key ? 'Unfollow' : 'Follow'}</button>
              <button type="button" onClick={() => onGodsEye(item.identity.key)} className="rounded border border-white/15 px-1 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200">God&apos;s Eye</button>
              <button type="button" onClick={() => onWatch(item.identity.key)} className="rounded border border-white/15 px-1 py-0.5 text-[9px] uppercase tracking-widest text-slate-300">{item.watched ? 'Watching' : 'Watch'}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
