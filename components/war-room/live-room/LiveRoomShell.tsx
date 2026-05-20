'use client'

import type { ReactNode } from 'react'

import type { DockPanelId } from './FeatureDock'
import { DockPanel } from './DockPanel'
import { FeatureDock } from './FeatureDock'

export type LiveRoomShellProps = {
  topBar: ReactNode
  council: ReactNode
  activePanelId: DockPanelId | null
  onPanelChange: (id: DockPanelId | null) => void
  dockPanel?: ReactNode
}

export function LiveRoomShell({
  topBar,
  council,
  activePanelId,
  onPanelChange,
  dockPanel,
}: LiveRoomShellProps) {
  return (
    <section
      className="live-room-shell relative z-10 flex min-h-0 flex-1 flex-col [--live-room-dock-pad:5.5rem]"
      data-testid="live-room-shell"
    >
      <header
        className="live-room-top flex-shrink-0 border-b border-yellow-900/70"
        style={{ background: 'rgba(0,0,0,0.5)' }}
      >
        {topBar}
      </header>

      <main
        className="live-room-center min-h-0 min-w-0 flex-1 overflow-hidden pb-[var(--live-room-dock-pad,5.5rem)]"
        data-testid="live-room-center"
      >
        {council}
      </main>

      {activePanelId && dockPanel ? (
        <DockPanel panelId={activePanelId} onClose={() => onPanelChange(null)}>
          {dockPanel}
        </DockPanel>
      ) : null}

      <footer
        className="live-room-dock fixed inset-x-0 bottom-0 z-20 border-t border-yellow-900/80 shadow-[0_-8px_32px_rgba(0,0,0,0.55)]"
        style={{ background: 'rgba(4,6,10,0.94)' }}
        data-testid="live-room-bottom-dock"
      >
        <FeatureDock activePanelId={activePanelId} onSelect={onPanelChange} />
      </footer>
    </section>
  )
}
