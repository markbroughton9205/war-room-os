'use client'

import { memo, type ReactNode } from 'react'

import type { DockPanelId } from './FeatureDock'
import { DOCK_ICONS } from './FeatureDock'

export type DockPanelProps = {
  panelId: DockPanelId
  onClose: () => void
  onMinimize?: () => void
  children: ReactNode
}

export const DockPanel = memo(function DockPanel({ panelId, onClose, onMinimize, children }: DockPanelProps) {
  const meta = DOCK_ICONS.find(icon => icon.id === panelId)
  const title = meta?.label ?? panelId

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[5.5rem] z-30 flex justify-center px-3 sm:px-6"
      data-testid="dock-panel-overlay"
    >
      <section
        className="pointer-events-auto flex max-h-[min(62vh,32rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-yellow-900/60 shadow-2xl"
        style={{ background: 'rgba(6,8,12,0.96)' }}
        role="dialog"
        aria-label={title}
      >
        <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-yellow-900/50 px-4 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-yellow-200">{title}</h2>
          <div className="flex gap-2">
            {onMinimize ? (
              <button
                type="button"
                className="rounded border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400"
                onClick={onMinimize}
              >
                Minimize
              </button>
            ) : null}
            <button
              type="button"
              className="rounded border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-300"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </section>
    </div>
  )
})

