'use client'

import type { ReactNode } from 'react'

import { MatrixRain } from './MatrixRain'
import type { DockPanelId } from './FeatureDock'
import { DockPanel } from './DockPanel'
import { FeatureDock } from './FeatureDock'

export type LiveRoomShellProps = {
  header: ReactNode
  intelRow: ReactNode
  leftNav: ReactNode
  council: ReactNode
  rightPanel: ReactNode
  commandConsole: ReactNode
  activePanelId: DockPanelId | null
  onPanelChange: (id: DockPanelId | null) => void
  dockPanel?: ReactNode
}

export function LiveRoomShell({
  header,
  intelRow,
  leftNav,
  council,
  rightPanel,
  commandConsole,
  activePanelId,
  onPanelChange,
  dockPanel,
}: LiveRoomShellProps) {
  return (
    <section
      className="live-room-shell relative z-10 flex min-h-0 flex-1 flex-col [--live-room-console-pad:3.25rem] [--live-room-dock-pad:4.75rem]"
      data-testid="live-room-shell"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <MatrixRain />
      </div>

      <div className="relative z-10 flex flex-shrink-0 flex-col">{header}</div>
      <div className="relative z-10 flex-shrink-0">{intelRow}</div>

      <main
        className="live-room-center relative z-10 grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-2 overflow-hidden px-2 pb-[calc(var(--live-room-dock-pad)+var(--live-room-console-pad))] pt-2 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,14rem)] lg:gap-3 lg:px-3"
        data-testid="live-room-center"
      >
        <div className="hidden min-h-0 lg:block">{leftNav}</div>
        <div className="min-h-0 min-w-0">{council}</div>
        <div className="hidden min-h-0 lg:block">{rightPanel}</div>
      </main>

      {activePanelId && dockPanel ? (
        <DockPanel panelId={activePanelId} onClose={() => onPanelChange(null)}>
          {dockPanel}
        </DockPanel>
      ) : null}

      <footer
        className="live-room-dock fixed inset-x-0 bottom-[var(--live-room-console-pad,3.25rem)] z-20"
        data-testid="live-room-bottom-dock"
      >
        <div
          className="border-t border-emerald-900/70 px-2 py-1"
          style={{ background: 'rgba(0,0,0,0.88)', boxShadow: '0 -6px 28px rgba(0,0,0,0.5)' }}
        >
          <FeatureDock activePanelId={activePanelId} onSelect={onPanelChange} />
        </div>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-30">{commandConsole}</div>
    </section>
  )
}
