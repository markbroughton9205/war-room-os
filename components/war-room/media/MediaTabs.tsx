'use client'

import { MEDIA_TABS, type MediaTabId } from '@/lib/media/types'
import { useMediaPlayback } from './MediaPlaybackProvider'

const TAB_LABEL: Record<MediaTabId, string> = {
  radio: 'Radio',
  news: 'News',
  weather: 'Weather',
  podcasts: 'Podcasts',
  saved: 'Saved',
}

function TabGlyph({ tab }: { tab: MediaTabId }) {
  const common = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true as const }
  if (tab === 'radio') {
    return (
      <svg {...common}>
        <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
        <path d="M8.2 12.6a5.2 5.2 0 0 1 7.6 0" />
        <path d="M5.4 9.8a9 9 0 0 1 13.2 0" />
      </svg>
    )
  }
  if (tab === 'news') {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="14" rx="1" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </svg>
    )
  }
  if (tab === 'weather') {
    return (
      <svg {...common}>
        <path d="M7 16h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.5A3.5 3.5 0 0 0 7 16z" />
      </svg>
    )
  }
  if (tab === 'podcasts') {
    return (
      <svg {...common}>
        <path d="M12 17v3" />
        <path d="M8 21h8" />
        <path d="M12 3a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M12 3l2.2 6.4H21l-5.3 3.9 2 6.2L12 15.8 6.3 19.5l2-6.2L3 9.4h6.8z" />
    </svg>
  )
}

export function MediaTabs() {
  const { state, controller } = useMediaPlayback()

  return (
    <nav className="flex shrink-0 flex-wrap gap-1.5 px-3.5 py-2" aria-label="Media sections" data-testid="media-tabs">
      {MEDIA_TABS.map(tab => {
        const active = state.activeTab === tab
        const enabled = tab === 'radio'
        return (
          <button
            key={tab}
            type="button"
            data-testid={`media-tab-${tab}`}
            disabled={!enabled}
            aria-pressed={active}
            title={enabled ? TAB_LABEL[tab] : `${TAB_LABEL[tab]} is not available this pass`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
              active
                ? 'border-emerald-400/80 bg-emerald-400 text-slate-950 shadow-[0_0_16px_rgba(52,211,153,0.35)]'
                : enabled
                  ? 'border-white/12 bg-black/30 text-slate-200 hover:border-cyan-300/40'
                  : 'cursor-not-allowed border-white/8 text-slate-600'
            }`}
            onClick={() => controller.setActiveTab(tab)}
          >
            <TabGlyph tab={tab} />
            {TAB_LABEL[tab]}
          </button>
        )
      })}
    </nav>
  )
}
