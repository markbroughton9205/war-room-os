'use client'

import type { RadarCatalog, RadarCoverageState, RadarFrame } from '@/lib/terra/weather'

export function TerraRadarStatus({
  catalog,
  state,
  frame,
  frameAge,
  enabled,
  playing,
  canAnimate,
  onToggle,
  onSelectFrame,
  onLatest,
  onPlay,
}: {
  catalog: RadarCatalog
  state: RadarCoverageState
  frame: RadarFrame | null
  frameAge: string
  enabled: boolean
  playing: boolean
  canAnimate: boolean
  onToggle: () => void
  onSelectFrame: (stamp: string) => void
  onLatest: () => void
  onPlay: (value: boolean) => void
}) {
  const selectedIndex = frame ? catalog.frames.findIndex(item => item.iemStamp === frame.iemStamp) : -1
  const stateClass = state === 'AVAILABLE'
    ? 'text-cyan-200'
    : state === 'STALE'
      ? 'text-amber-200'
      : 'text-slate-400'

  return (
    <aside
      className="pointer-events-auto w-[min(36rem,92vw)] rounded-xl border border-cyan-300/25 bg-black/75 px-2.5 py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      data-testid="terra-weather-radar-status"
      data-radar-state={state}
      data-radar-enabled={enabled ? '1' : '0'}
      data-radar-product={catalog.product}
      data-radar-frame={frame?.iemStamp ?? ''}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">Radar</p>
        <p className={`font-mono text-[10px] uppercase tracking-widest ${stateClass}`}>{state}</p>
        <p className="font-mono text-[10px] text-slate-300">{catalog.providerName.split('/')[0]?.trim()} · {catalog.product}</p>
        <p className="font-mono text-[10px] text-slate-400">
          FRAME {frame ? frame.timestampIso.replace('.000Z', 'Z') : 'NONE'} · {frameAge}
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
      <p className="mt-1 text-[9px] leading-snug text-slate-500">
        MEASURED · {catalog.attribution}
      </p>
    </aside>
  )
}
