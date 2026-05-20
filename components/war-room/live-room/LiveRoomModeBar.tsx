'use client'

import { memo } from 'react'

import { useLiveRoomMode, type LiveRoomMode } from './LiveRoomModeContext'
import { useWarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'

const MODES: { id: LiveRoomMode; label: string }[] = [
  { id: 'operator', label: 'Operator' },
  { id: 'builder', label: 'Builder' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'repair', label: 'Repair' },
]

export const LiveRoomModeBar = memo(function LiveRoomModeBar() {
  const { liveMode, setLiveMode, engineeringDrawerOpen, toggleEngineeringDrawer } = useLiveRoomMode()
  const { uiMode, setUiMode } = useWarRoomUiMode()

  return (
    <section className="flex flex-wrap items-center justify-between gap-2 border-b border-yellow-900/60 px-4 py-1.5" data-testid="live-room-mode-bar">
      <section className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[9px] tracking-widest text-slate-500">Live mode</span>
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="rounded px-2 py-0.5 text-[9px] font-bold tracking-widest"
            style={{
              border: liveMode === id ? '1px solid #FFD700' : '1px solid #333',
              color: liveMode === id ? '#FFD700' : '#888',
            }}
            onClick={() => {
              setLiveMode(id)
              if (id === 'repair' || id === 'builder') setUiMode('advanced')
              if (id === 'operator') setUiMode('operator')
            }}
          >
            {label}
          </button>
        ))}
      </section>
      <section className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[9px] font-bold tracking-widest"
          style={{
            border: engineeringDrawerOpen ? '1px solid #38BDF8' : '1px solid #444',
            color: engineeringDrawerOpen ? '#38BDF8' : '#888',
          }}
          onClick={toggleEngineeringDrawer}
        >
          Engineering {engineeringDrawerOpen ? 'open' : 'closed'}
        </button>
        <span className="text-[8px] text-slate-600">UI: {uiMode}</span>
      </section>
    </section>
  )
})
