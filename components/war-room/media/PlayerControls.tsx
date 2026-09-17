'use client'

import { isPlaybackEligible } from '@/lib/media/provenance'
import { MediaIcon } from './MediaIcons'
import { useMediaPlayback } from './MediaPlaybackProvider'

export function PlayerControls({ compact = false }: { compact?: boolean }) {
  const { state, controller } = useMediaPlayback()
  const playing = state.playbackState === 'playing' || state.playbackState === 'loading'
  const eligible = isPlaybackEligible(state.station)
  const playLabel = playing ? 'Pause' : eligible ? 'Play' : 'Playback unavailable'

  return (
    <div className={`flex items-center ${compact ? 'gap-2' : 'justify-between gap-3'}`} data-testid={compact ? 'media-controls-compact' : 'media-controls'}>
      <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-3'}`}>
        <button
          type="button"
          className={chromeButton(compact)}
          aria-label="Previous station"
          onClick={() => controller.previousStation()}
        >
          <MediaIcon name="prev" />
        </button>
        <button
          type="button"
          className={compact
            ? chromeButton(true)
            : 'grid h-16 w-16 place-items-center rounded-full border-2 border-emerald-300 bg-emerald-400 text-slate-950 shadow-[0_0_28px_rgba(52,211,153,0.5)] hover:bg-emerald-300'}
          aria-label={playLabel}
          title={state.errorMessage ?? playLabel}
          data-testid="media-play-pause"
          onClick={() => controller.togglePlay()}
          data-media-play-gate="commander-gesture"
        >
          <MediaIcon name={playing ? 'pause' : 'play'} className={compact ? undefined : 'h-6 w-6'} />
        </button>
        <button
          type="button"
          className={chromeButton(compact)}
          aria-label="Next station"
          onClick={() => controller.nextStation()}
        >
          <MediaIcon name="next" />
        </button>
      </div>
      <div className={`flex min-w-0 items-center gap-2 ${compact ? 'flex-1' : 'w-[11rem]'}`}>
        <button
          type="button"
          className={chromeButton(compact)}
          aria-label={state.muted ? 'Unmute' : 'Mute'}
          aria-pressed={state.muted}
          data-testid="media-mute"
          onClick={() => controller.toggleMuted()}
        >
          <MediaIcon name={state.muted ? 'muted' : 'volume'} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.muted ? 0 : state.volume}
          aria-label="Volume"
          data-testid="media-volume"
          className="h-1 w-full accent-emerald-400"
          onChange={event => {
            const value = Number(event.target.value)
            if (state.muted && value > 0) controller.setMuted(false)
            controller.setVolume(value)
          }}
        />
      </div>
    </div>
  )
}

function chromeButton(compact: boolean) {
  return compact
    ? 'grid h-8 w-8 place-items-center rounded-md border border-white/12 text-[11px] text-slate-200 hover:border-cyan-300/40'
    : 'grid h-9 w-9 place-items-center rounded-lg border border-white/12 text-[11px] text-slate-200 hover:border-cyan-300/40'
}
