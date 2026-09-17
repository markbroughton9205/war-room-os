'use client'

import { useEffect } from 'react'

import { IconRadio } from '@/components/war-room/council/CommandIcons'
import { mediaStreamStatusLabel } from '@/lib/media/playbackStatus'
import { useMediaPlayback } from './MediaPlaybackProvider'

export function MediaLauncher({
  variant = 'header',
  layout = 'stack',
}: {
  variant?: 'header' | 'fallback' | 'dock'
  layout?: 'stack' | 'rail'
}) {
  const { state, controller } = useMediaPlayback()
  const open = state.presentation !== 'closed'
  const windowOpen = state.presentation === 'window'
  const live = state.playbackState === 'playing'
  const status = mediaStreamStatusLabel(state.playbackState)

  useEffect(() => {
    if (variant !== 'header' && variant !== 'dock') return
    controller.setHeaderLauncherMounted(true)
    return () => controller.setHeaderLauncherMounted(false)
  }, [controller, variant])

  const label =
    windowOpen ? 'Focus War Room Media' : state.presentation === 'compact' ? 'Restore War Room Media' : 'Open War Room Media'

  if (variant === 'dock' && layout === 'rail') {
    return (
      <button
        type="button"
        data-testid="media-launcher-dock"
        data-media-launcher="dock"
        aria-label={label}
        aria-pressed={open}
        title="War Room Media"
        className="pointer-events-auto flex w-full min-h-[3.25rem] items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left backdrop-blur-xl"
        style={{
          borderColor: open ? 'rgba(52, 211, 153, 0.7)' : 'rgba(34, 211, 238, 0.45)',
          background: open ? 'rgba(6, 78, 59, 0.45)' : 'rgba(2, 12, 20, 0.88)',
          boxShadow: open
            ? '0 0 18px rgba(52, 211, 153, 0.28)'
            : '0 0 14px rgba(34, 211, 238, 0.16)',
        }}
        onClick={() => controller.launch()}
      >
        <span
          className="commander-agent-icon grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-emerald-200"
          style={{
            ['--commander-agent-glow' as string]: 'rgba(52, 211, 153, 0.7)',
            borderColor: 'rgba(52, 211, 153, 0.55)',
            background: 'rgba(6, 78, 59, 0.35)',
          }}
          data-state={live ? 'active' : open ? 'selected' : 'idle'}
        >
          <IconRadio size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] font-black uppercase leading-tight tracking-[0.14em] text-cyan-100">
            War Room Media
          </span>
          <span className="mt-0.5 block text-[8px] uppercase tracking-widest text-slate-400">
            {open ? status : 'Radio'}
          </span>
        </span>
      </button>
    )
  }

  if (variant === 'dock') {
    return (
      <button
        type="button"
        data-testid="media-launcher-dock"
        data-media-launcher="dock"
        aria-label={label}
        aria-pressed={open}
        title="War Room Media"
        className="flex flex-col items-center gap-0.5"
        onClick={() => controller.launch()}
      >
        <span
          className="commander-agent-icon grid h-9 w-9 place-items-center rounded-full border bg-slate-950/80 backdrop-blur-xl"
          style={{
            ['--commander-agent-glow' as string]: 'rgba(52, 211, 153, 0.55)',
            borderColor: open ? 'rgba(52, 211, 153, 0.65)' : 'rgba(148,163,184,0.28)',
            color: open ? '#e2e8f0' : '#94a3b8',
          }}
          data-state={live ? 'active' : open ? 'selected' : 'idle'}
        >
          <IconRadio size={15} />
        </span>
        <span className={`max-w-[4.5rem] text-center text-[6px] font-bold uppercase leading-tight tracking-[0.12em] ${open ? 'text-cyan-100' : 'text-slate-400'}`}>
          War Room Media
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-testid={variant === 'header' ? 'media-launcher' : 'media-launcher-fallback'}
      data-media-launcher={variant}
      aria-label={label}
      aria-pressed={open}
      title="War Room Media"
      className={
        variant === 'header'
          ? 'inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-950/40'
          : 'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-cyan-400/35 bg-black/75 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-cyan-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-cyan-200/60'
      }
      onClick={() => controller.launch()}
    >
      <IconRadio size={12} />
      War Room Media
    </button>
  )
}
