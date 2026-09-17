'use client'

import { isPlaybackEligible } from '@/lib/media/provenance'
import { surfaceReasonCopy } from '@/lib/media/intelContext'
import { mediaStreamStatusLabel } from '@/lib/media/playbackStatus'
import { useMediaPlayback } from './MediaPlaybackProvider'
import { GoToIntelButton } from './GoToIntelButton'
import { OfficialSiteButton } from './OfficialSiteButton'
import { PlayerControls } from './PlayerControls'
import { LiveWaveform, StationArt } from './StationArt'

export function NowPlaying() {
  const { state, controller } = useMediaPlayback()
  const station = state.station
  const live = state.playbackState === 'playing'
  const eligible = isPlaybackEligible(station)
  const why = surfaceReasonCopy(state.surfaceReason, station)
  const streamStatus = mediaStreamStatusLabel(state.playbackState)

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-[rgba(3,8,14,0.55)] p-3.5" data-testid="media-now-playing">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Now Playing</h3>
        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500" data-testid="media-origin-badge">
          {state.origin === 'auto' ? 'Auto' : 'Manual'}
        </span>
      </div>

      {!station ? (
        <p className="text-[11px] text-slate-500">No station selected.</p>
      ) : (
        <>
          <div className="flex gap-3.5">
            <StationArt station={station} size="lg" live={live} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[20px] font-black tracking-tight text-white">
                {station.callSign}
                {station.frequency ? ` ${station.frequency}` : ''}
              </p>
              <p className="truncate text-[13px] text-slate-200">{station.name}</p>
              <p className="truncate text-[12px] text-slate-400">{station.city}</p>
              {station.provider && station.provider !== station.name ? (
                <p className="mt-1 truncate text-[10px] text-slate-500">{station.provider}</p>
              ) : null}
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-slate-600'}`} />
                <span className={live ? 'text-emerald-300' : 'text-slate-500'} data-testid="media-stream-status">
                  {eligible || live ? streamStatus : station.sourceClass}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-200/90">{station.verificationState}</span>
              </p>
            </div>
          </div>

          <div className="mt-3">
            <LiveWaveform active={live} />
          </div>

          {why ? (
            <p className="mt-2 text-[10px] leading-relaxed text-cyan-200/80" data-testid="media-why-surfaced">
              Why this surfaced: {why}
            </p>
          ) : null}

          {state.errorMessage ? (
            <p className="mt-2 text-[10px] leading-relaxed text-amber-300">{state.errorMessage}</p>
          ) : null}

          <div className="mt-4">
            <PlayerControls />
          </div>

          <div className="mt-3 flex gap-2">
            <GoToIntelButton />
            <button
              type="button"
              className={`flex flex-1 items-center justify-center rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${
                state.sourceInfoOpen
                  ? 'border-cyan-300/50 bg-cyan-950/40 text-cyan-100'
                  : 'border-white/12 text-slate-300 hover:border-cyan-300/40'
              }`}
              aria-pressed={state.sourceInfoOpen}
              data-testid="media-station-info"
              onClick={() => controller.toggleSourceInfo()}
            >
              Source
            </button>
            <OfficialSiteButton />
          </div>
        </>
      )}
    </section>
  )
}
