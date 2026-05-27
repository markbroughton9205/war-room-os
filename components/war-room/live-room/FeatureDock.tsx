'use client'

import { memo, useState } from 'react'

import { matrixStatus } from '@/lib/ui/matrixStatusBus'

export type DockPanelId =
  | 'live-council'
  | 'command-intel'
  | 'operations'
  | 'memory-core'
  | 'approvals'
  | 'analytics'
  | 'red-team'
  | 'system-health'
  | 'settings'

export type DockIconDef = {
  id: DockPanelId
  label: string
  glyph: string
}

export const DOCK_ICONS: DockIconDef[] = [
  { id: 'live-council', label: 'Live Council', glyph: '⚡' },
  { id: 'command-intel', label: 'Command Intel', glyph: '📡' },
  { id: 'operations', label: 'Operations', glyph: '⚙' },
  { id: 'memory-core', label: 'Memory Core', glyph: '🧠' },
  { id: 'approvals', label: 'Approvals', glyph: '✓' },
  { id: 'analytics', label: 'Analytics', glyph: '📊' },
  { id: 'red-team', label: 'Red Team', glyph: '🛡' },
  { id: 'system-health', label: 'System Health', glyph: '♥' },
  { id: 'settings', label: 'Settings', glyph: '⚙️' },
]

export type FeatureDockProps = {
  activePanelId: DockPanelId | null
  onSelect: (id: DockPanelId | null) => void
}

export const FeatureDock = memo(function FeatureDock({ activePanelId, onSelect }: FeatureDockProps) {
  const [hovered, setHovered] = useState<DockPanelId | null>(null)

  return (
    <nav
      className="mx-auto flex max-w-3xl items-end justify-center gap-0.5 overflow-x-auto px-2 py-0.5 sm:gap-1.5 sm:px-3"
      aria-label="War Room feature dock"
      data-testid="feature-dock"
    >
      {DOCK_ICONS.map(icon => {
        const active = activePanelId === icon.id
        const showLabel = hovered === icon.id
        return (
          <button
            key={icon.id}
            type="button"
            className="group relative flex shrink-0 flex-col items-center"
            aria-label={icon.label}
            aria-pressed={active}
            onMouseEnter={() => setHovered(icon.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => {
              if (icon.id === 'live-council') {
                matrixStatus('success', 'Live Council focused')
                onSelect(null)
                return
              }
              if (active) {
                matrixStatus('warning', `${icon.label} closed`)
                onSelect(null)
              } else {
                matrixStatus('working', `Opening ${icon.label}…`)
                onSelect(icon.id)
              }
            }}
          >
            {showLabel ? (
              <span className="pointer-events-none absolute -top-7 z-10 whitespace-nowrap rounded bg-black/95 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-200">
                {icon.label}
              </span>
            ) : null}
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-sm transition-transform sm:h-10 sm:w-10 sm:text-base"
              style={{
                border: active ? '1px solid rgba(52,211,153,0.7)' : '1px solid rgba(255,255,255,0.12)',
                background: active ? 'rgba(0,255,102,0.12)' : 'rgba(0,0,0,0.6)',
                transform: showLabel || active ? 'scale(1.1) translateY(-3px)' : 'scale(1)',
                boxShadow: active ? '0 0 18px rgba(0,255,102,0.28)' : undefined,
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
