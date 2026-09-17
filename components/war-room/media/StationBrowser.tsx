'use client'

import { useMediaPlayback } from './MediaPlaybackProvider'
import { StationRow } from './StationRow'

export function StationBrowser() {
  const { stations } = useMediaPlayback()

  return (
    <section
      className="flex min-h-0 flex-col rounded-2xl border border-cyan-400/20 bg-[rgba(3,8,14,0.55)]"
      data-testid="media-station-browser"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-200">Ohio Stations</h3>
        <span className="text-[9px] uppercase tracking-widest text-slate-500">{stations.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {stations.map(station => (
          <StationRow key={station.id} stationId={station.id} />
        ))}
      </div>
    </section>
  )
}
