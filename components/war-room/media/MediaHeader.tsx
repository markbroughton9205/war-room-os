'use client'

import { IconBroadcast } from '@/components/war-room/council/CommandIcons'
import { mediaAutoModeLabel } from '@/lib/media/autoMediaPreference'
import { useMediaPlayback } from './MediaPlaybackProvider'

const CHROME_BTN =
  'grid h-7 w-7 place-items-center rounded-md border border-white/12 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100'

export function MediaHeader() {
  const { state, controller } = useMediaPlayback()

  return (
    <header
      className="flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-cyan-400/15 px-3.5 py-2.5 active:cursor-grabbing"
      data-testid="media-window-header"
      data-media-drag-handle="true"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-400/45 bg-emerald-400/10 text-emerald-200 shadow-[0_0_18px_rgba(52,211,153,0.25)]">
          <IconBroadcast size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-black uppercase tracking-[0.14em] text-white">War Room Media</p>
          <p className="truncate text-[10px] tracking-[0.08em] text-slate-400">Local. Regional. Global.</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="rounded-full border border-white/12 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-slate-300 hover:border-cyan-300/40"
          data-testid="media-auto-mode"
          title="AUTO MEDIA: Off / Surface Only. Auto Media never starts audio."
          onClick={event => {
            event.stopPropagation()
            controller.cycleAutoMediaMode()
          }}
        >
          Auto {mediaAutoModeLabel(state.autoMediaMode)}
        </button>
        <button
          type="button"
          className={`${CHROME_BTN} ${state.pinned ? 'border-cyan-300/50 text-cyan-100' : ''}`}
          aria-pressed={state.pinned}
          aria-label={state.pinned ? 'Unpin Media window' : 'Pin Media window'}
          title="Pin (in-app only)"
          data-testid="media-pin"
          onClick={event => {
            event.stopPropagation()
            controller.togglePinned()
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={state.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 17v5" />
            <path d="M8 3h8l-1 7h-6L8 3z" />
            <path d="M7 10h10v2H7z" />
          </svg>
        </button>
        <button
          type="button"
          className={CHROME_BTN}
          aria-label="Minimize Media"
          title="Minimize"
          data-testid="media-minimize"
          onClick={event => {
            event.stopPropagation()
            controller.minimize()
          }}
        >
          <span aria-hidden="true">─</span>
        </button>
        <button
          type="button"
          className={CHROME_BTN}
          aria-label="Close Media"
          title="Close and stop audio"
          data-testid="media-close"
          onClick={event => {
            event.stopPropagation()
            controller.close()
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </header>
  )
}
