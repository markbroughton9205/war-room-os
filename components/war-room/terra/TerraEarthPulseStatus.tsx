'use client'

import type { EarthPulseEngineState, EarthPulseCloudCatalog, NightLightsCatalog } from '@/lib/terra/earthPulse'
import { LIVING_ORBIT_DISCLAIMER, LIVING_ORBIT_LABEL } from '@/lib/terra/earthPulse'

function truthClass(state: string): string {
  if (state === 'LIVE' || state === 'RECENT') return 'text-cyan-200'
  if (state === 'STALE') return 'text-amber-200'
  return 'text-slate-400'
}

export function TerraEarthPulseStatus({
  engine,
  clouds,
  cloudPlaying,
  cloudFrameIndex,
  lightningState,
  lightningCount,
  auroraState,
  auroraMax,
  night,
  orbiting,
  radarState,
  radarAge,
  onCloudPlay,
  onCloudFrame,
}: {
  engine: EarthPulseEngineState | null
  clouds: EarthPulseCloudCatalog
  cloudPlaying: boolean
  cloudFrameIndex: number
  lightningState: string
  lightningCount: number
  auroraState: string
  auroraMax: number
  night: NightLightsCatalog | null
  orbiting: boolean
  radarState?: string
  radarAge?: string
  onCloudPlay: (value: boolean) => void
  onCloudFrame: (index: number) => void
}) {
  const east = clouds.frames.filter(frame => frame.satellite === (clouds.playbackSatellite ?? 'GOES-East'))
  const cloudFrame = east[cloudFrameIndex] ?? east[east.length - 1] ?? clouds.frames[clouds.frames.length - 1] ?? null
  const cloudsState = engine?.domains.clouds.truthState ?? clouds.truthState
  const nightLabel = night
    ? (night.mode === 'DAILY' ? `OBSERVED · RECENT NIGHT RADIANCE · ${night.productDate}` : 'OBSERVED · ARCHIVAL BLACK MARBLE · 2016')
    : 'LOADING'
  const appearance = cloudFrame?.appearance === 'INFRARED' ? 'IR' : 'GeoColor'
  const failover = clouds.federation?.failover ?? 'NONE'

  return (
    <div
      className="mt-1.5 space-y-1"
      data-testid="terra-earth-pulse"
      data-cloud-layer-max="4"
      data-cloud-playback={cloudPlaying ? 'active' : 'paused'}
      data-cloud-frame-index={String(cloudFrameIndex)}
      data-cloud-appearance={appearance}
      data-cloud-failover={failover}
      data-night-truth={night?.mode === 'DAILY' ? 'OBSERVED_RECENT' : night?.mode === 'ARCHIVE' ? 'OBSERVED_ARCHIVE' : ''}
      data-archive-live-claim="no"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Earth Pulse</span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
          {orbiting ? `${LIVING_ORBIT_LABEL} · presentation` : 'idle'}
        </span>
      </div>
      <p className="sr-only" data-testid="terra-living-orbit">{orbiting ? '1' : '0'} {LIVING_ORBIT_DISCLAIMER}</p>
      <ul className="space-y-0.5 font-mono text-[9px] uppercase tracking-widest text-slate-400">
        <li className="flex items-center justify-between gap-2" data-testid="terra-clouds-state" data-state={cloudsState} data-frames={String(east.length)}>
          <span>Clouds</span>
          <span className={truthClass(cloudsState)}>{cloudsState} · {appearance} · {cloudFrame ? cloudFrame.timestampIso.replace('.000Z', 'Z') : 'NONE'}</span>
        </li>
        <li className="flex items-center justify-between gap-2" data-testid="terra-precip-state" data-state={radarState ?? 'UNAVAILABLE'}>
          <span>Precipitation</span>
          <span className={truthClass(radarState === 'AVAILABLE' ? 'RECENT' : radarState === 'STALE' ? 'STALE' : 'UNAVAILABLE')}>{radarState ?? '…'} · NEXRAD · {radarAge ?? '—'}</span>
        </li>
        <li className="flex items-center justify-between gap-2" data-testid="terra-lightning-state" data-state={lightningState} data-count={String(lightningCount)}>
          <span>Lightning</span>
          <span className={truthClass(lightningState)}>{lightningState} · GLM · {lightningCount}</span>
        </li>
        <li className="flex items-center justify-between gap-2" data-testid="terra-aurora-state" data-state={auroraState} data-max={String(auroraMax)}>
          <span>Aurora</span>
          <span className={truthClass(auroraState)}>{auroraState} · OVATION · max {auroraMax}</span>
        </li>
        <li className="flex items-center justify-between gap-2" data-testid="terra-eq-pulse" data-count={String(engine?.domains.earthquakes.itemCount ?? 0)}>
          <span>Earthquakes</span>
          <span className={truthClass(engine?.domains.earthquakes.truthState ?? 'UNAVAILABLE')}>{engine?.domains.earthquakes.truthState ?? '…'} · USGS</span>
        </li>
        <li className="flex items-center justify-between gap-2" data-testid="terra-night-lights-mode" data-mode={night?.mode ?? ''} data-date={night?.productDate ?? ''} data-truth-class="OBSERVED">
          <span>Night lights</span>
          <span className={night?.mode === 'DAILY' ? 'text-cyan-200' : 'text-slate-400'}>{nightLabel}</span>
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid="terra-clouds-play"
          disabled={east.length < 2}
          onClick={() => onCloudPlay(!cloudPlaying)}
          className="rounded border border-white/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-30"
        >
          {cloudPlaying ? 'Pause frames' : 'Play frames'}
        </button>
        {east.length > 1 ? (
          <input
            type="range"
            min={0}
            max={east.length - 1}
            value={Math.min(cloudFrameIndex, east.length - 1)}
            onChange={event => onCloudFrame(Number(event.target.value))}
            data-testid="terra-clouds-scrub"
            className="h-1 w-24 accent-cyan-300"
          />
        ) : null}
      </div>
      <p className="text-[8px] leading-snug text-slate-600">
        Clouds are successive observed frames with presentation alpha, not a sliding texture. Night-side GeoColor is an IR composite, not natural visible color. Himawari/RealEarth stay unlabeled until timestamped tiles prove. Radar is measured IEM NEXRAD, translucent. Lightning is GOES East/West GLM only. Aurora is OVATION probability, not a polar decoration. Night lights are OBSERVED radiance or 2016 archive — never live electricity. Close-zoom building glow is PRESENTATION only.
      </p>
    </div>
  )
}
