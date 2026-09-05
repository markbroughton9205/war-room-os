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
  systemHealthGapCount?: number
  /**
   * Commander correction (2026-08-05) — Expand Chat: a pure layout toggle. `leftNav`/`rightPanel`
   * stay mounted in the tree (just not rendered) so no state they hold is lost, and `council`
   * itself is never remounted, so transcript/scroll state persists across toggling either way.
   */
  chatExpanded?: boolean
  sessionNavOpen?: boolean
  inspectorOpen?: boolean
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
  systemHealthGapCount,
  chatExpanded = false,
  sessionNavOpen = true,
  inspectorOpen = false,
}: LiveRoomShellProps) {
  const showLeft = !chatExpanded && sessionNavOpen
  const showRight = !chatExpanded && inspectorOpen
  const gridClass = showLeft && showRight
    ? 'live-room-center relative z-10 grid min-h-0 min-w-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_18rem] overflow-hidden'
    : showLeft
      ? 'live-room-center relative z-10 grid min-h-0 min-w-0 flex-1 grid-cols-[16rem_minmax(0,1fr)] overflow-hidden'
      : showRight
        ? 'live-room-center relative z-10 grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_18rem] overflow-hidden'
        : 'live-room-center relative z-10 grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden'
  return (
    <section
      className="live-room-shell relative z-10 flex min-h-0 w-full flex-1 flex-col [--live-room-console-pad:3.5rem] [--live-room-dock-pad:3.25rem] [--live-room-bottom-reserved:calc(var(--live-room-console-pad)+var(--live-room-dock-pad))] sm:[--live-room-console-pad:3.75rem]"
      data-testid="live-room-shell"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <MatrixRain />
      </div>

      <div className="relative z-10 flex flex-shrink-0 flex-col">{header}</div>
      {intelRow ? <div className="relative z-10 flex-shrink-0">{intelRow}</div> : null}

      <main
        className={gridClass}
        data-testid="live-room-center"
      >
        <div className={showLeft ? 'min-h-0 overflow-hidden p-2' : 'hidden'}>{leftNav}</div>
        <div className="flex min-h-0 min-w-0 flex-col">{council}</div>
        <div className={showRight ? 'min-h-0 overflow-hidden p-2' : 'hidden'}>{rightPanel}</div>
      </main>

      {activePanelId && dockPanel ? (
        <DockPanel panelId={activePanelId} onClose={() => onPanelChange(null)}>
          {dockPanel}
        </DockPanel>
      ) : null}

      <div
        className="live-room-bottom-stack relative z-20 flex flex-shrink-0 flex-col"
        data-testid="live-room-bottom-stack"
      >
        <footer className="live-room-dock flex-shrink-0" data-testid="live-room-bottom-dock">
          <div
            className="border-t border-emerald-900/70 px-2 py-0.5 sm:py-1"
            style={{ background: 'rgba(0,0,0,0.88)', boxShadow: '0 -4px 20px rgba(0,0,0,0.45)' }}
          >
            <FeatureDock
              activePanelId={activePanelId}
              onSelect={onPanelChange}
              systemHealthGapCount={systemHealthGapCount}
            />
          </div>
        </footer>
        {commandConsole ? <div className="live-room-console flex-shrink-0">{commandConsole}</div> : null}
      </div>
    </section>
  )
}
