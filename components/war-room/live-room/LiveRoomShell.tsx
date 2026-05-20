'use client'

import type { ReactNode } from 'react'

export type LiveRoomShellProps = {
  topBar: ReactNode
  modeBar?: ReactNode
  ambientFeed?: ReactNode
  leftRail?: ReactNode
  center: ReactNode
  rightRail: ReactNode
  bottomDock: ReactNode
  engineeringDrawer?: ReactNode
}

export function LiveRoomShell({
  topBar,
  modeBar,
  ambientFeed,
  leftRail,
  center,
  rightRail,
  bottomDock,
  engineeringDrawer,
}: LiveRoomShellProps) {
  return (
    <section
      className="live-room-shell relative z-10 flex min-h-0 flex-1 flex-col [--live-room-dock-pad:7.5rem]"
      data-testid="live-room-shell"
    >
      <header className="live-room-top flex-shrink-0 border-b border-yellow-900/70" style={{ background: 'rgba(0,0,0,0.5)' }}>
        {topBar}
        {modeBar}
      </header>
      {ambientFeed ? (
        <section className="live-room-ambient flex-shrink-0 border-b border-white/5 px-3 py-1.5" style={{ background: 'rgba(0,0,0,0.35)' }}>
          {ambientFeed}
        </section>
      ) : null}
      <section className="live-room-body grid flex-1 grid-cols-1 gap-3 px-3 py-3 xl:grid-cols-[min(16rem,22vw)_minmax(0,1fr)_min(22rem,32vw)] xl:items-start">
        {leftRail ? (
          <aside className="live-room-left-rail min-h-0 min-w-0 space-y-3 xl:sticky xl:top-2 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto">
            {leftRail}
          </aside>
        ) : null}
        <main
          className="live-room-center min-h-0 min-w-0 pb-[var(--live-room-dock-pad,7.5rem)]"
          data-testid="live-room-center"
        >
          {center}
        </main>
        <aside className="live-room-rail min-h-0 min-w-0 space-y-3 xl:sticky xl:top-2 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto">
          {rightRail}
        </aside>
      </section>
      {engineeringDrawer}
      <footer
        className="live-room-dock fixed inset-x-0 bottom-0 z-20 border-t border-yellow-900/80 shadow-[0_-8px_32px_rgba(0,0,0,0.55)]"
        style={{ background: 'rgba(4,6,10,0.94)' }}
        data-testid="live-room-bottom-dock"
      >
        {bottomDock}
      </footer>
    </section>
  )
}
