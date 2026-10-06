'use client'

export function TerraWeatherAtmosphereControls({
  cloudsEnabled,
  cloudOpacity,
  cloudPlaying,
  cloudCanAnimate,
  radarEnabled,
  radarOpacity,
  radarPlaying,
  radarCanAnimate,
  weatherDepthAuto,
  onCloudsEnabled,
  onCloudOpacity,
  onCloudPlay,
  onRadarEnabled,
  onRadarOpacity,
  onRadarPlay,
  onRadarLatest,
  onWeatherDepthAuto,
}: {
  cloudsEnabled: boolean
  cloudOpacity: number
  cloudPlaying: boolean
  cloudCanAnimate: boolean
  radarEnabled: boolean
  radarOpacity: number
  radarPlaying: boolean
  radarCanAnimate: boolean
  weatherDepthAuto: boolean
  onCloudsEnabled: (value: boolean) => void
  onCloudOpacity: (value: number) => void
  onCloudPlay: (value: boolean) => void
  onRadarEnabled: (value: boolean) => void
  onRadarOpacity: (value: number) => void
  onRadarPlay: (value: boolean) => void
  onRadarLatest: () => void
  onWeatherDepthAuto: (value: boolean) => void
}) {
  return (
    <div className="space-y-2" data-testid="terra-weather-atmosphere-controls">
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 text-[10px] font-bold uppercase tracking-widest text-slate-500">Clouds</span>
        <button type="button" onClick={() => onCloudsEnabled(!cloudsEnabled)} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300">
          {cloudsEnabled ? 'On' : 'Off'}
        </button>
        <button type="button" disabled={!cloudCanAnimate} onClick={() => onCloudPlay(!cloudPlaying)} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30">
          {cloudPlaying ? 'Pause' : 'Auto'}
        </button>
        <label className="flex flex-1 items-center gap-1 text-[9px] uppercase tracking-widest text-slate-500">
          Opacity
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(cloudOpacity * 100)}
            onChange={event => onCloudOpacity(Number(event.target.value) / 100)}
            className="h-1 flex-1 accent-cyan-300"
            data-testid="terra-clouds-opacity"
            aria-label="Cloud presentation opacity"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 text-[10px] font-bold uppercase tracking-widest text-slate-500">Radar</span>
        <button type="button" onClick={() => onRadarEnabled(!radarEnabled)} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300">
          {radarEnabled ? 'On' : 'Off'}
        </button>
        <button type="button" onClick={onRadarLatest} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300">
          Latest
        </button>
        <button type="button" disabled={!radarCanAnimate} onClick={() => onRadarPlay(!radarPlaying)} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300 disabled:opacity-30">
          {radarPlaying ? 'Pause' : 'Play'}
        </button>
        <label className="flex flex-1 items-center gap-1 text-[9px] uppercase tracking-widest text-slate-500">
          Opacity
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(radarOpacity * 100)}
            onChange={event => onRadarOpacity(Number(event.target.value) / 100)}
            className="h-1 flex-1 accent-cyan-300"
            data-testid="terra-radar-opacity"
            aria-label="Radar presentation opacity"
          />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Weather depth</span>
        <button type="button" onClick={() => onWeatherDepthAuto(!weatherDepthAuto)} className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300" data-testid="terra-weather-depth-auto">
          {weatherDepthAuto ? 'Auto' : 'Locked'}
        </button>
      </div>
    </div>
  )
}
