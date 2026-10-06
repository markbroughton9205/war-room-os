'use client'

import {
  radarIntensityBandLabel,
  type RadarActiveDetails,
  type RadarCatalog,
  type RadarCoverageState,
  type RadarFrame,
} from '@/lib/terra/weather'

export function TerraRadarStatus({
  catalog,
  state,
  frame,
  frameAge,
  details,
  enabled,
  playing,
  canAnimate,
  onToggle,
  onSelectFrame,
  onLatest,
  onPlay,
  opacity,
  onOpacity,
}: {
  catalog: RadarCatalog
  state: RadarCoverageState
  frame: RadarFrame | null
  frameAge: string
  details: RadarActiveDetails
  enabled: boolean
  playing: boolean
  canAnimate: boolean
  onToggle: () => void
  onSelectFrame: (stamp: string) => void
  onLatest: () => void
  onPlay: (value: boolean) => void
  opacity?: number
  onOpacity?: (value: number) => void
}) {
  const selectedIndex = frame ? catalog.frames.findIndex(item => item.iemStamp === frame.iemStamp) : -1
  const stateClass = details.status === 'ACTIVE'
    ? 'text-cyan-200'
    : details.status === 'STALE' || details.status === 'DEGRADED' || details.status === 'PARTIAL'
      ? 'text-amber-200'
      : 'text-slate-400'

  return (
    <aside
      className="pointer-events-auto w-[min(36rem,92vw)] rounded-xl border border-cyan-300/25 bg-black/75 px-2.5 py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      data-testid="terra-weather-radar-status"
      data-radar-state={state}
      data-radar-status={details.status}
      data-radar-echo={details.echoState}
      data-radar-coverage-fit={details.coverageFit}
      data-radar-enabled={enabled ? '1' : '0'}
      data-radar-product={catalog.product}
      data-radar-frame={frame?.iemStamp ?? ''}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Radar</p>
        <p className={`font-mono text-[10px] uppercase tracking-widest ${stateClass}`} data-testid="terra-weather-radar-status-label">{details.status}</p>
        <p className="font-mono text-[10px] text-slate-300">{catalog.providerName.split('/')[0]?.trim()} · {catalog.product}</p>
        <p className="font-mono text-[10px] text-slate-400" data-testid="terra-weather-radar-frame-time">
          FRAME {details.frameTime.utc}{details.frameTime.local ? ` · ${details.frameTime.local} ${details.frameTime.localZone ?? 'local'}` : ''} · {frameAge}
        </p>
        <button
          type="button"
          onClick={onToggle}
          className="rounded border border-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-200"
          data-testid="terra-weather-radar-toggle"
        >
          Radar {enabled ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={onLatest}
          className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400"
        >
          Latest
        </button>
        <button
          type="button"
          disabled={!canAnimate || catalog.frames.length < 2}
          onClick={() => onPlay(!playing)}
          className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400 disabled:opacity-30"
        >
          {playing ? 'Pause frames' : 'Play frames'}
        </button>
        {onOpacity ? (
          <label className="flex min-w-[8rem] flex-1 items-center gap-1 text-[9px] uppercase tracking-widest text-slate-500">
            Opacity
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((opacity ?? 1) * 100)}
              onChange={event => onOpacity(Number(event.target.value) / 100)}
              className="h-1 flex-1 accent-cyan-300"
              data-testid="terra-weather-radar-opacity"
              aria-label="Radar opacity"
            />
          </label>
        ) : null}
      </div>
      {catalog.frames.length > 1 ? (
        <input
          type="range"
          min={0}
          max={catalog.frames.length - 1}
          value={selectedIndex >= 0 ? selectedIndex : catalog.frames.length - 1}
          onChange={event => {
            const next = catalog.frames[Number(event.target.value)]
            if (next) onSelectFrame(next.iemStamp)
          }}
          className="mt-1 w-full accent-cyan-300"
          data-testid="terra-weather-radar-scrubber"
          aria-label="Radar frame history"
        />
      ) : null}

      {enabled ? (
        <div
          className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-white/10 pt-1 font-mono text-[9px]"
          data-testid="terra-weather-radar-active-details"
        >
          <span className="text-slate-500">STATUS</span>
          <span className={stateClass}>{details.status} · {details.statusReason}</span>
          <span className="text-slate-500">AGE</span>
          <span className="text-slate-300">{frameAge} · updates every {details.expectedUpdateSeconds}s</span>
          <span className="text-slate-500">COVERAGE</span>
          <span className="text-slate-300" data-testid="terra-weather-radar-coverage">
            {details.coverageFit} · {details.coverageLabel}{details.quorumLabel ? ` · ${details.quorumLabel}` : ''}
          </span>
          <span className="text-slate-500">PRECIP</span>
          <span className="text-slate-300" data-testid="terra-weather-radar-echo">{details.echoLabel}</span>
        </div>
      ) : null}

      {enabled ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="terra-weather-radar-legend">
          <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
            {details.legendUnit}
          </span>
          {details.legendBands.map(band => (
            <span key={band.minDbz} className="flex items-center gap-1 font-mono text-[9px] text-slate-400">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: band.color }} aria-hidden />
              {radarIntensityBandLabel(band)} {band.label}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-1 text-[9px] leading-snug text-slate-500">
        MEASURED · {catalog.attribution}
      </p>
    </aside>
  )
}
