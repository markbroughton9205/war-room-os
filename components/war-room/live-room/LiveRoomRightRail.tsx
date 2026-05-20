'use client'

import dynamic from 'next/dynamic'
import { memo } from 'react'
import { PanelErrorBoundary } from '@/components/war-room/runtime/PanelErrorBoundary'
import { LiveEnvironmentPanel } from '@/components/intelligence/LiveEnvironmentPanel'
import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { CommanderLocationState, LocationMode } from '@/lib/intelligence/environment/locationPolicy'
import type { AstrologyInterpretationMode } from '@/lib/intelligence/environment/horoscopeEnvironment'
import type { CouncilResearchHandoff } from '@/lib/council-research/types'

function RailSkeleton({ label }: { label: string }) {
  return (
    <section className="rounded border border-white/10 bg-black/25 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500">{label}</div>
      <div className="mt-2 h-16 animate-pulse rounded bg-white/5" />
    </section>
  )
}

const SignalRadarPanel = dynamic(
  () => import('@/components/war-room/signals/SignalRadarPanel').then(mod => mod.SignalRadarPanel),
  { ssr: false, loading: () => <RailSkeleton label="Signal Radar loading" /> },
)

const RuntimeIntegrityPanel = dynamic(
  () => import('@/components/war-room/runtime/RuntimeIntegrityPanel').then(mod => mod.RuntimeIntegrityPanel),
  { ssr: false, loading: () => <RailSkeleton label="Runtime integrity loading" /> },
)

export type LiveRoomRightRailProps = {
  enabled: boolean
  liveEnvironment: {
    liveResearchHud: LiveResearchClientUi | null
    location: CommanderLocationState
    horoscopeEnabled: boolean
    astrologyMode: AstrologyInterpretationMode
    onSetLocationMode: (mode: LocationMode) => void
    onForgetLocation: () => void
    onToggleHoroscope: () => void
    onSetAstrologyMode: (mode: AstrologyInterpretationMode) => void
    onCouncilHandoff: (decree: string) => void
    onCouncilResearchHandoff?: (payload: CouncilResearchHandoff) => void
    threadId?: string
    hideEvolutionPanel?: boolean
  }
}

export const LiveRoomRightRail = memo(function LiveRoomRightRail({ enabled, liveEnvironment }: LiveRoomRightRailProps) {
  if (!enabled) {
    return (
      <p className="rounded border border-white/10 p-3 text-[10px] tracking-widest text-slate-500">
        Intelligence rail idle — switch to Command Center.
      </p>
    )
  }

  return (
    <div className="space-y-3" data-testid="live-room-right-rail">
      <PanelErrorBoundary label="Signal Radar">
        <SignalRadarPanel />
      </PanelErrorBoundary>
      <PanelErrorBoundary label="News & local intel">
        <LiveEnvironmentPanel
          liveResearchHud={liveEnvironment.liveResearchHud}
          location={liveEnvironment.location}
          horoscopeEnabled={liveEnvironment.horoscopeEnabled}
          astrologyMode={liveEnvironment.astrologyMode}
          onSetLocationMode={liveEnvironment.onSetLocationMode}
          onForgetLocation={liveEnvironment.onForgetLocation}
          onToggleHoroscope={liveEnvironment.onToggleHoroscope}
          onSetAstrologyMode={liveEnvironment.onSetAstrologyMode}
          onCouncilHandoff={liveEnvironment.onCouncilHandoff}
          onCouncilResearchHandoff={liveEnvironment.onCouncilResearchHandoff}
          threadId={liveEnvironment.threadId}
          hideEvolutionPanel={liveEnvironment.hideEvolutionPanel}
        />
      </PanelErrorBoundary>
      <PanelErrorBoundary label="Runtime alerts">
        <RuntimeIntegrityPanel />
      </PanelErrorBoundary>
    </div>
  )
})
