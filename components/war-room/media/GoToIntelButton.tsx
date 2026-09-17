'use client'

import { useRouter } from 'next/navigation'

import { intelContextForStation, persistMediaIntelHandoff } from '@/lib/media/intelContext'
import { MediaIcon } from './MediaIcons'
import { useMediaPlayback } from './MediaPlaybackProvider'

export function GoToIntelButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const { state } = useMediaPlayback()
  const intel = intelContextForStation(state.station)

  return (
    <button
      type="button"
      disabled={!intel}
      title={intel ? `${intel.label} — ${intel.note}` : 'No regional intelligence context is recorded'}
      data-testid="media-go-to-intel"
      className={compact
        ? 'flex flex-1 items-center justify-center gap-1 rounded-full border border-cyan-300/40 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-950/40 disabled:cursor-not-allowed disabled:border-white/8 disabled:text-slate-600'
        : 'flex flex-1 items-center justify-center gap-1.5 rounded-full border border-cyan-300/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-950/40 disabled:cursor-not-allowed disabled:border-white/8 disabled:text-slate-600'}
      onClick={() => {
        if (!intel) return
        persistMediaIntelHandoff(intel)
        router.push(intel.href)
      }}
    >
      <MediaIcon name="intel" />
      Go to Intel
    </button>
  )
}
