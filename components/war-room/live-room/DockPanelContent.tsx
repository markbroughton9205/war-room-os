'use client'

import dynamic from 'next/dynamic'
import { memo, type ReactNode } from 'react'
import { PanelErrorBoundary } from '@/components/war-room/runtime/PanelErrorBoundary'
import { LiveEnvironmentPanel } from '@/components/intelligence/LiveEnvironmentPanel'
import { WarRoomEvolutionPanel } from '@/components/war-room/evolution'
import { OperatorCommandDeck, OperatorCommandEnvironment } from '@/components/war-room/operator'
import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { CommanderLocationState, LocationMode } from '@/lib/intelligence/environment/locationPolicy'
import type { AstrologyInterpretationMode } from '@/lib/intelligence/environment/horoscopeEnvironment'
import type { CouncilRepairPacket } from '@/lib/council-repair'
import type { DockPanelId } from './FeatureDock'
import { useLiveRoomMode } from './LiveRoomModeContext'

function PanelSkeleton({ label }: { label: string }) {
  return (
    <section className="rounded border border-white/10 bg-black/25 p-3 text-[10px] tracking-widest text-slate-500">
      {label} loading…
    </section>
  )
}

const SignalRadarPanel = dynamic(
  () => import('@/components/war-room/signals/SignalRadarPanel').then(m => m.SignalRadarPanel),
  { ssr: false, loading: () => <PanelSkeleton label="News & Signals" /> },
)
const ProviderRuntimePanel = dynamic(
  () => import('@/components/war-room/providers/ProviderRuntimePanel').then(m => m.ProviderRuntimePanel),
  { ssr: false, loading: () => <PanelSkeleton label="AI Team Status" /> },
)
const OpportunityScoutPanel = dynamic(
  () => import('@/components/war-room/opportunities/OpportunityScoutPanel').then(m => m.OpportunityScoutPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Opportunities" /> },
)
const SchemaSweepPanel = dynamic(
  () => import('@/components/war-room/schema/SchemaSweepPanel').then(m => m.SchemaSweepPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Schema sweep" /> },
)
const RepairPacketPanel = dynamic(
  () => import('@/components/war-room/engineering/RepairPacketPanel').then(m => m.RepairPacketPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Repairs" /> },
)
const WarRoomSweepPanel = dynamic(
  () => import('@/components/war-room/evolution/WarRoomSweepPanel').then(m => m.WarRoomSweepPanel),
  { ssr: false, loading: () => <PanelSkeleton label="OS sweep" /> },
)
const ProductionDiagnosticsPanel = dynamic(
  () => import('@/components/war-room/diagnostics/ProductionDiagnosticsPanel').then(m => m.ProductionDiagnosticsPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Diagnostics" /> },
)
const Phase6MemoryPanels = dynamic(
  () => import('@/components/war-room/memory/Phase6MemoryPanels').then(m => m.Phase6MemoryPanels),
  { ssr: false, loading: () => <PanelSkeleton label="Memory" /> },
)
const RuntimeIntegrityPanel = dynamic(
  () => import('@/components/war-room/runtime/RuntimeIntegrityPanel').then(m => m.RuntimeIntegrityPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Runtime pressure" /> },
)

export type DockPanelContentProps = {
  panelId: DockPanelId
  latestRepairPacket?: CouncilRepairPacket | null
  sessionIndicators?: ReactNode
  onCouncilHandoff?: (decree: string) => void
  onOpenEngineering?: () => void
  liveEnvironment?: {
    liveResearchHud: LiveResearchClientUi | null
    location: CommanderLocationState
    horoscopeEnabled: boolean
    astrologyMode: AstrologyInterpretationMode
    onSetLocationMode: (mode: LocationMode) => void
    onForgetLocation: () => void
    onToggleHoroscope: () => void
    onSetAstrologyMode: (mode: AstrologyInterpretationMode) => void
    onCouncilHandoff: (decree: string) => void
    threadId?: string
  }
  babyObserver?: ReactNode
  commandCenterExtras?: ReactNode
  builderExtras?: ReactNode
}

export const DockPanelContent = memo(function DockPanelContent({
  panelId,
  latestRepairPacket,
  sessionIndicators,
  onCouncilHandoff,
  onOpenEngineering,
  liveEnvironment,
  babyObserver,
  commandCenterExtras,
  builderExtras,
}: DockPanelContentProps) {
  const { setLiveMode, setEngineeringDrawerOpen } = useLiveRoomMode()

  const openBuilder = () => {
    setLiveMode('builder')
    setEngineeringDrawerOpen(true)
    onOpenEngineering?.()
  }

  return (
    <PanelErrorBoundary label={panelId}>
      {panelId === 'news-intel' && liveEnvironment ? (
        <LiveEnvironmentPanel
          {...liveEnvironment}
          hideEvolutionPanel
        />
      ) : null}
      {panelId === 'opportunities' ? <OpportunityScoutPanel /> : null}
      {panelId === 'system-health' ? (
        <div className="space-y-3">
          <WarRoomEvolutionPanel onCouncilHandoff={onCouncilHandoff} />
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">AI Team Status</p>
            <ProviderRuntimePanel />
          </section>
        </div>
      ) : null}
      {panelId === 'repairs' ? <RepairPacketPanel latest={latestRepairPacket ?? null} /> : null}
      {panelId === 'memory' ? <Phase6MemoryPanels /> : null}
      {panelId === 'news-signals' ? <SignalRadarPanel /> : null}
      {panelId === 'income-workers' ? <OpportunityScoutPanel /> : null}
      {panelId === 'operator-tasks' ? (
        <div className="space-y-3">
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-sky-300">Live AI Updates</p>
            <p className="mb-2 text-[9px] text-slate-500">Mission queue and packet feed from command graph.</p>
          </section>
          <OperatorCommandEnvironment
            version="36"
            sessionIndicators={sessionIndicators ?? null}
            onOpenEngineering={openBuilder}
          />
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-yellow-200">My Command Center</p>
            <OperatorCommandDeck />
          </section>
          {commandCenterExtras}
        </div>
      ) : null}
      {panelId === 'baby-observer' ? babyObserver : null}
      {panelId === 'builder-tools' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <WarRoomSweepPanel />
          <SchemaSweepPanel />
          <ProductionDiagnosticsPanel />
          <RuntimeIntegrityPanel />
          {builderExtras}
        </div>
      ) : null}
    </PanelErrorBoundary>
  )
})
