'use client'

import { memo, type ReactNode } from 'react'

import { WarRoomEvolutionPanel } from '@/components/war-room/evolution'
import { OperatorCommandEnvironment } from '@/components/war-room/operator'
import { useLiveRoomMode } from './LiveRoomModeContext'

export type LiveRoomLeftRailProps = {
  sessionIndicators: ReactNode
  onCouncilHandoff?: (decree: string) => void
  onOpenEngineering?: () => void
}

export const LiveRoomLeftRail = memo(function LiveRoomLeftRail({
  sessionIndicators,
  onCouncilHandoff,
  onOpenEngineering,
}: LiveRoomLeftRailProps) {
  const { liveMode } = useLiveRoomMode()
  const showMission = liveMode === 'operator' || liveMode === 'builder'
  const emphasizeEvolution = liveMode === 'repair' || liveMode === 'builder'

  return (
    <aside className="space-y-3" data-testid="live-room-left-rail">
      {showMission ? (
        <OperatorCommandEnvironment
          version="24"
          sessionIndicators={sessionIndicators}
          onOpenEngineering={onOpenEngineering ?? (() => undefined)}
        />
      ) : (
        <section className="rounded border border-white/10 bg-black/25 p-2 text-[9px] text-slate-500">
          Mission Control emphasized in Operator/Builder modes. Switch mode to view missions.
        </section>
      )}
      <section className={emphasizeEvolution ? 'ring-1 ring-violet-500/40 rounded' : undefined}>
        <WarRoomEvolutionPanel onCouncilHandoff={onCouncilHandoff} />
      </section>
    </aside>
  )
})
