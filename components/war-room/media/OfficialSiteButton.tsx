'use client'

import { useMediaPlayback } from './MediaPlaybackProvider'

export function OfficialSiteButton({ compact = false }: { compact?: boolean }) {
  const { state } = useMediaPlayback()
  const station = state.station
  const href = station?.listenPage || station?.homepage || null
  const className = compact
    ? 'flex flex-1 items-center justify-center rounded-full border border-white/12 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-widest text-slate-300 hover:border-cyan-300/40'
    : 'flex flex-1 items-center justify-center rounded-full border border-white/12 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-300 hover:border-cyan-300/40'

  if (!href) {
    return (
      <button
        type="button"
        disabled
        title="No official homepage is recorded"
        data-testid="media-official-site"
        className={`${className} cursor-not-allowed border-white/8 text-slate-600`}
      >
        Open Official Site
      </button>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid="media-official-site"
      className={className}
    >
      Open Official Site
    </a>
  )
}
