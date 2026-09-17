'use client'

import { surfaceReasonCopy } from '@/lib/media/intelContext'
import { mediaStreamStatusLabel } from '@/lib/media/playbackStatus'
import { useMediaPlayback } from './MediaPlaybackProvider'
import { GoToIntelButton } from './GoToIntelButton'
import { MediaIcon } from './MediaIcons'
import { PlayerControls } from './PlayerControls'
import { SourceInfo } from './SourceInfo'
import { StationArt } from './StationArt'

export function CompactMediaPlayer() {
  const { state, controller } = useMediaPlayback()
  const station = state.station
  const live = state.playbackState === 'playing'
  const auto = state.origin === 'auto'
  const why = surfaceReasonCopy(state.surfaceReason, station)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-3"
      style={{ bottom: '8rem' }}
      data-testid="compact-media-player-layer"
      data-media-compact-placement="above-timeline"
    >
      <section
        className="pointer-events-auto w-full max-w-xl rounded-2xl border border-cyan-400/35 bg-[rgba(4,10,16,0.94)] px-3 py-2.5 shadow-[0_16px_50px_rgba(0,0,0,0.55),0_0_28px_rgba(16,185,129,0.12)] backdrop-blur-2xl"
        data-testid="compact-media-player"
        aria-label={auto ? 'War Room Media auto surface' : 'War Room Media compact player'}
      >
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <StationArt station={station} size="sm" live={live} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-white">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${live ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="uppercase tracking-widest text-slate-400" data-testid="media-compact-origin">
                  War Room Media{auto ? ' · Auto' : ''}
                </span>
                <span className="truncate">
                  {station ? `${station.callSign}${station.frequency ? ` ${station.frequency}` : ''}` : 'No station'}
                </span>
              </p>
              <p className="truncate text-[11px] text-slate-300">
                {station ? `${station.name} · ${station.city}` : 'Playback session idle'}
              </p>
              <p className="truncate text-[9px] uppercase tracking-widest text-slate-500" data-testid="media-stream-status">
                {mediaStreamStatusLabel(state.playbackState)}
                {station ? ` · ${station.verificationState}` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-md border border-white/12 text-slate-300"
              aria-label="Expand Media window"
              data-testid="media-restore"
              onClick={() => controller.restore()}
            >
              <MediaIcon name="expand" />
            </button>
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-md border border-white/12 text-slate-300"
              aria-label="Close Media"
              data-testid="media-compact-close"
              onClick={() => controller.close()}
            >
              <MediaIcon name="close" />
            </button>
          </div>
        </div>

        {why ? (
            <p className="mb-1.5 text-[10px] leading-relaxed text-cyan-200/80" data-testid="media-why-surfaced">
              {live ? `Why this is playing: ${why}` : why}
            </p>
        ) : null}

        <PlayerControls compact />

        <div className="mt-2 flex gap-1.5">
          <GoToIntelButton compact />
          <button
            type="button"
            className={`flex flex-1 items-center justify-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${
              state.sourceInfoOpen
                ? 'border-cyan-300/50 text-cyan-100'
                : 'border-white/12 text-slate-300 hover:border-cyan-300/40'
            }`}
            data-testid="media-station-info"
            onClick={() => controller.toggleSourceInfo()}
          >
            <MediaIcon name="source" />
            Source
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1 rounded-full border border-white/12 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300 hover:border-cyan-300/40"
            data-testid="media-expand"
            onClick={() => controller.restore()}
          >
            Expand
          </button>
        </div>

        <div className="mt-2">
          <SourceInfo />
        </div>
      </section>
    </div>
  )
}
