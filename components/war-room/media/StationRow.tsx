'use client'

import type { MediaVerificationState } from '@/lib/media/types'
import { isPlaybackEligible } from '@/lib/media/provenance'
import { useMediaPlayback } from './MediaPlaybackProvider'
import { MiniEq, StationArt } from './StationArt'

const HEALTH_DOT: Record<MediaVerificationState, string> = {
  VERIFIED: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.85)]',
  STALE: 'bg-amber-400',
  UNVERIFIED: 'bg-slate-500',
  DEAD: 'bg-red-500',
  UNAVAILABLE: 'bg-slate-600',
}

export function StationRow({ stationId }: { stationId: string }) {
  const { state, stations, controller } = useMediaPlayback()
  const station = stations.find(entry => entry.id === stationId)
  if (!station) return null

  const selected = state.station?.id === station.id
  const playing = selected && state.playbackState === 'playing'
  const eligible = isPlaybackEligible(station)

  return (
    <button
      type="button"
      data-testid={`media-station-${station.id}`}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-2 py-1.5 text-left ${
        selected
          ? 'border-cyan-300/70 bg-cyan-400/10 shadow-[0_0_16px_rgba(34,211,238,0.12)]'
          : 'border-transparent hover:border-white/10 hover:bg-white/5'
      }`}
      onClick={() => controller.selectStation(station.id)}
    >
      <StationArt station={station} size="sm" live={playing} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12px] font-semibold ${selected ? 'text-cyan-100' : 'text-white'}`}>
          {station.callSign}
          {station.frequency ? ` ${station.frequency}` : ''}
        </span>
        <span className="block truncate text-[10px] text-slate-400">{station.name}</span>
        <span className="block truncate text-[9px] text-slate-500">{station.city}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {playing ? <MiniEq active /> : !eligible ? (
          <span className="text-[8px] uppercase tracking-widest text-slate-600">{station.sourceClass}</span>
        ) : null}
        <span
          className={`h-2 w-2 rounded-full ${HEALTH_DOT[station.verificationState]}`}
          title={`${station.verificationState} — ${station.notes}`}
          aria-label={`Verification ${station.verificationState}`}
        />
      </span>
    </button>
  )
}
