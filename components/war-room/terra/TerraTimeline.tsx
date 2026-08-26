'use client'

/**
 * Terra's first real timeline control (Phase 6) — replaces the "Time Controls" placeholder.
 * Deliberately compact: mode indicator, LIVE/return-to-live, a handful of historical jump
 * shortcuts, play/pause + playback rate, and the time-window preset. Not the final cinematic
 * command-center timeline (mission section 11) — the globe stays dominant.
 */
import type { TerraPlaybackRate, TerraTimeState } from '@/lib/terra/types'
import { TERRA_PLAYBACK_RATES } from '@/lib/terra/types'
import type { TerraTimeWindowPreset } from '@/lib/terra/terraTime'

type Props = {
  time: TerraTimeState
  onGoLive: () => void
  onScrub: (isoTime: string) => void
  onPlay: () => void
  onPause: () => void
  onPlaybackRateChange: (rate: TerraPlaybackRate) => void
  windowPresets: TerraTimeWindowPreset[]
  selectedWindowId: string
  onWindowChange: (id: string) => void
  cinematicOrbiting: boolean
  cinematicSuppressedByReducedMotion: boolean
  onResumeCinematic: () => void
}

const JUMP_SHORTCUTS: { label: string; msAgo: number }[] = [
  { label: '-1H', msAgo: 3_600_000 },
  { label: '-24H', msAgo: 24 * 3_600_000 },
  { label: '-7D', msAgo: 7 * 24 * 3_600_000 },
]

function formatUtcLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function TerraTimeline({
  time,
  onGoLive,
  onScrub,
  onPlay,
  onPause,
  onPlaybackRateChange,
  windowPresets,
  selectedWindowId,
  onWindowChange,
  cinematicOrbiting,
  cinematicSuppressedByReducedMotion,
  onResumeCinematic,
}: Props) {
  const isLive = time.mode === 'live'

  return (
    <div className="pointer-events-auto w-[min(640px,90vw)] rounded border border-white/10 bg-black/70 p-3 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${isLive ? 'text-emerald-400' : 'text-amber-400'}`}>
          {isLive ? 'LIVE — NOW' : `HISTORICAL — ${formatUtcLabel(time.currentTime)}`}
        </p>
        <div className="flex items-center gap-1">
          {cinematicOrbiting && <span className="text-[9px] uppercase tracking-widest text-cyan-400/70">cinematic</span>}
          {!cinematicSuppressedByReducedMotion && !cinematicOrbiting && isLive && (
            <button type="button" onClick={onResumeCinematic} className="rounded border border-white/20 px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-400 hover:border-cyan-400/60 hover:text-cyan-400">
              Resume Cinematic View
            </button>
          )}
          <button
            type="button"
            onClick={onGoLive}
            disabled={isLive}
            className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
              isLive ? 'cursor-default border-emerald-400/40 text-emerald-400/50' : 'border-emerald-400/60 text-emerald-400 hover:bg-emerald-400/10'
            }`}
          >
            {isLive ? 'Live' : 'Return to Live'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        {JUMP_SHORTCUTS.map(shortcut => (
          <button
            key={shortcut.label}
            type="button"
            onClick={() => onScrub(new Date(Date.now() - shortcut.msAgo).toISOString())}
            className="rounded border border-white/20 px-2 py-0.5 uppercase tracking-widest text-slate-300 hover:border-amber-400/60 hover:text-amber-400"
          >
            {shortcut.label}
          </button>
        ))}

        <input
          type="datetime-local"
          className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 text-slate-200"
          value={time.currentTime.slice(0, 16)}
          max={new Date().toISOString().slice(0, 16)}
          onChange={event => {
            if (!event.target.value) return
            onScrub(new Date(`${event.target.value}:00.000Z`).toISOString())
          }}
        />

        <button
          type="button"
          onClick={time.playing ? onPause : onPlay}
          disabled={isLive}
          className={`rounded border px-2 py-0.5 uppercase tracking-widest ${
            isLive ? 'cursor-default border-white/10 text-slate-600' : 'border-white/20 text-slate-300 hover:border-amber-400/60 hover:text-amber-400'
          }`}
        >
          {time.playing ? 'Pause' : 'Play'}
        </button>

        <select
          value={time.playbackRate}
          onChange={event => onPlaybackRateChange(Number(event.target.value) as TerraPlaybackRate)}
          disabled={isLive}
          className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 uppercase tracking-widest text-slate-300 disabled:text-slate-600"
        >
          {TERRA_PLAYBACK_RATES.map(rate => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>

        <span className="mx-1 text-slate-600">|</span>

        <span className="text-slate-500">Window</span>
        {windowPresets.map(preset => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onWindowChange(preset.id)}
            className={`rounded border px-2 py-0.5 uppercase tracking-widest ${
              selectedWindowId === preset.id ? 'border-cyan-400/60 text-cyan-400' : 'border-white/20 text-slate-400 hover:border-cyan-400/40'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  )
}
