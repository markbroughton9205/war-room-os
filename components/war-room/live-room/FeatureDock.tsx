'use client'

import { memo, useState } from 'react'

export type DockPanelId =
  | 'news-intel'
  | 'opportunities'
  | 'system-health'
  | 'repairs'
  | 'memory'
  | 'news-signals'
  | 'income-workers'
  | 'operator-tasks'
  | 'baby-observer'
  | 'builder-tools'

export type DockIconDef = {
  id: DockPanelId
  label: string
  glyph: string
}

export const DOCK_ICONS: DockIconDef[] = [
  { id: 'news-intel', label: 'News & Intel', glyph: '📰' },
  { id: 'opportunities', label: 'Opportunities', glyph: '💡' },
  { id: 'system-health', label: 'System Health & Repairs', glyph: '🛡' },
  { id: 'repairs', label: 'Repairs', glyph: '🔧' },
  { id: 'memory', label: 'Memory', glyph: '🧠' },
  { id: 'news-signals', label: 'News & Signals', glyph: '📡' },
  { id: 'income-workers', label: 'Income Workers', glyph: '💰' },
  { id: 'operator-tasks', label: 'My Command Center', glyph: '⚔' },
  { id: 'baby-observer', label: 'Baby Observer', glyph: '👶' },
  { id: 'builder-tools', label: 'Builder Tools', glyph: '🏗' },
]

export type FeatureDockProps = {
  activePanelId: DockPanelId | null
  onSelect: (id: DockPanelId | null) => void
}

export const FeatureDock = memo(function FeatureDock({ activePanelId, onSelect }: FeatureDockProps) {
  const [hovered, setHovered] = useState<DockPanelId | null>(null)

  return (
    <nav
      className="flex items-end justify-center gap-1 px-3 py-2 sm:gap-2 sm:px-6"
      aria-label="War Room feature dock"
      data-testid="feature-dock"
    >
      {DOCK_ICONS.map(icon => {
        const active = activePanelId === icon.id
        const hoveredLabel = hovered === icon.id
        return (
          <button
            key={icon.id}
            type="button"
            className="group relative flex flex-col items-center"
            aria-label={icon.label}
            aria-pressed={active}
            onMouseEnter={() => setHovered(icon.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect(active ? null : icon.id)}
          >
            {hoveredLabel ? (
              <span className="pointer-events-none absolute -top-7 whitespace-nowrap rounded bg-black/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-yellow-200">
                {icon.label}
              </span>
            ) : null}
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl text-lg transition-transform sm:h-12 sm:w-12"
              style={{
                border: active ? '1px solid #FFD700' : '1px solid rgba(255,255,255,0.15)',
                background: active ? 'rgba(255,215,0,0.12)' : 'rgba(0,0,0,0.55)',
                transform: hoveredLabel || active ? 'scale(1.12) translateY(-4px)' : 'scale(1)',
                boxShadow: active ? '0 0 16px rgba(255,215,0,0.25)' : undefined,
              }}
            >
              {icon.glyph}
            </span>
          </button>
        )
      })}
    </nav>
  )
})
