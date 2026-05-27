'use client'

import dynamic from 'next/dynamic'
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { PanelErrorBoundary } from '@/components/war-room/runtime/PanelErrorBoundary'
import { LiveEnvironmentPanel } from '@/components/intelligence/LiveEnvironmentPanel'
import { WarRoomEvolutionPanel } from '@/components/war-room/evolution'
import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { CommanderLocationState, LocationMode } from '@/lib/intelligence/environment/locationPolicy'
import type { AstrologyInterpretationMode } from '@/lib/intelligence/environment/horoscopeEnvironment'
import type { CouncilResearchHandoff } from '@/lib/council-research/types'
import type { CouncilRepairPacket } from '@/lib/council-repair'
import {
  countOpenOperatorGaps,
  resolveOperatorGaps,
  type GapFinderContext,
} from '@/lib/operator/gapFinder'
import {
  inboxExtrasFromGapContext,
  loadOperatorInboxSnapshot,
  shouldShowCouncilBurstNote,
  syncOperatorInboxFromGaps,
  type OperatorInboxSnapshot,
} from '@/lib/operator/inbox'
import { loadSelfRepairSnapshot } from '@/lib/operator/selfRepair'
import { loadUpgradeQueue } from '@/lib/operator/upgradeQueue'
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
  { ssr: false, loading: () => <PanelSkeleton label="Analytics" /> },
)
const ProviderRuntimePanel = dynamic(
  () => import('@/components/war-room/providers/ProviderRuntimePanel').then(m => m.ProviderRuntimePanel),
  { ssr: false, loading: () => <PanelSkeleton label="AI Team Status" /> },
)
const OpportunityScoutPanel = dynamic(
  () => import('@/components/war-room/opportunities/OpportunityScoutPanel').then(m => m.OpportunityScoutPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Operations" /> },
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
  { ssr: false, loading: () => <PanelSkeleton label="Memory Core" /> },
)
const RuntimeIntegrityPanel = dynamic(
  () => import('@/components/war-room/runtime/RuntimeIntegrityPanel').then(m => m.RuntimeIntegrityPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Runtime pressure" /> },
)
const OperatorCommandEnvironment = dynamic(
  () => import('@/components/war-room/operator').then(m => m.OperatorCommandEnvironment),
  { ssr: false, loading: () => <PanelSkeleton label="Command environment" /> },
)
const OperatorCommandDeck = dynamic(
  () => import('@/components/war-room/operator').then(m => m.OperatorCommandDeck),
  { ssr: false, loading: () => <PanelSkeleton label="Command Center" /> },
)
const GapFinderPanel = dynamic(
  () => import('@/components/war-room/operator/GapFinderPanel').then(m => m.GapFinderPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Gap Finder" /> },
)
const OperatorInboxPanel = dynamic(
  () => import('@/components/war-room/operator/OperatorInboxPanel').then(m => m.OperatorInboxPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Operator Inbox" /> },
)
const SelfRepairPanel = dynamic(
  () => import('@/components/war-room/operator/SelfRepairPanel').then(m => m.SelfRepairPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Self-repair" /> },
)
const UpgradeQueuePanel = dynamic(
  () => import('@/components/war-room/operator/UpgradeQueuePanel').then(m => m.UpgradeQueuePanel),
  { ssr: false, loading: () => <PanelSkeleton label="Upgrade queue" /> },
)
const SelfRepairRulesPanel = dynamic(
  () => import('@/components/war-room/operator/SelfRepairRulesPanel').then(m => m.SelfRepairRulesPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Self-repair rules" /> },
)

const SystemHealthOperatorPanels = memo(function SystemHealthOperatorPanels({
  gapFinderContext,
  onGapCountChange,
}: {
  gapFinderContext: GapFinderContext
  onGapCountChange?: (count: number) => void
}) {
  const [inboxSnapshot, setInboxSnapshot] = useState<OperatorInboxSnapshot>(() =>
    loadOperatorInboxSnapshot(),
  )
  const [repairSnapshot, setRepairSnapshot] = useState(() => loadSelfRepairSnapshot())
  const [upgradeQueue, setUpgradeQueue] = useState(() => loadUpgradeQueue())

  const inboxExtras = useMemo(() => inboxExtrasFromGapContext(gapFinderContext), [gapFinderContext])

  const showCouncilBurstNote = useMemo(
    () => shouldShowCouncilBurstNote(inboxSnapshot, inboxExtras),
    [inboxExtras, inboxSnapshot],
  )

  const recheckInbox = useCallback(() => {
    const existing = loadOperatorInboxSnapshot()
    const mergedContext: GapFinderContext = {
      ...gapFinderContext,
      commanderManualFixedAt: existing.commanderManualFixedAt,
      commanderDismissedIds: existing.commanderDismissedIds,
    }
    const gaps = resolveOperatorGaps(mergedContext)
    setInboxSnapshot(
      syncOperatorInboxFromGaps(gaps, {
        extras: inboxExtras,
        commanderManualFixedAt: existing.commanderManualFixedAt,
        commanderDismissedIds: existing.commanderDismissedIds,
        existing,
      }),
    )
  }, [gapFinderContext, inboxExtras])

  const mergedGapContext = useMemo<GapFinderContext>(
    () => ({
      ...gapFinderContext,
      commanderManualFixedAt: inboxSnapshot.commanderManualFixedAt,
      commanderDismissedIds: inboxSnapshot.commanderDismissedIds,
    }),
    [gapFinderContext, inboxSnapshot.commanderDismissedIds, inboxSnapshot.commanderManualFixedAt],
  )

  const applyCommanderPatch = useCallback(
    (patch: {
      commanderManualFixedAt?: Record<string, string>
      commanderDismissedIds?: Record<string, string>
    }) => {
      const commanderManualFixedAt =
        patch.commanderManualFixedAt ?? inboxSnapshot.commanderManualFixedAt
      const commanderDismissedIds =
        patch.commanderDismissedIds ?? inboxSnapshot.commanderDismissedIds
      const ctx: GapFinderContext = {
        ...gapFinderContext,
        commanderManualFixedAt,
        commanderDismissedIds,
      }
      const gaps = resolveOperatorGaps(ctx)
      setInboxSnapshot(
        syncOperatorInboxFromGaps(gaps, {
          extras: inboxExtras,
          commanderManualFixedAt,
          commanderDismissedIds,
          existing: inboxSnapshot,
        }),
      )
    },
    [gapFinderContext, inboxExtras, inboxSnapshot],
  )

  const onCommanderManualFix = useCallback(
    (gapId: string) => {
      const markedAt = new Date().toISOString()
      applyCommanderPatch({
        commanderManualFixedAt: { ...inboxSnapshot.commanderManualFixedAt, [gapId]: markedAt },
      })
    },
    [applyCommanderPatch, inboxSnapshot.commanderManualFixedAt],
  )

  const onCommanderDismiss = useCallback(
    (gapId: string) => {
      const markedAt = new Date().toISOString()
      applyCommanderPatch({
        commanderDismissedIds: { ...inboxSnapshot.commanderDismissedIds, [gapId]: markedAt },
      })
    },
    [applyCommanderPatch, inboxSnapshot.commanderDismissedIds],
  )

  const openGapCount = useMemo(
    () => countOpenOperatorGaps(resolveOperatorGaps(mergedGapContext)),
    [mergedGapContext],
  )

  return (
    <>
      <SelfRepairPanel repairSnapshot={repairSnapshot} openGapCount={openGapCount} />
      <UpgradeQueuePanel queue={upgradeQueue} onQueueChange={setUpgradeQueue} />
      <SelfRepairRulesPanel />
      <OperatorInboxPanel
        snapshot={inboxSnapshot}
        onSnapshotChange={setInboxSnapshot}
        showCouncilBurstNote={showCouncilBurstNote}
        onRecheck={recheckInbox}
        gapFinderContext={mergedGapContext}
        repairSnapshot={repairSnapshot}
        onRepairSnapshotChange={setRepairSnapshot}
        onUpgradeQueueChange={setUpgradeQueue}
      />
      <GapFinderPanel
        context={mergedGapContext}
        onGapCountChange={onGapCountChange}
        onInboxSnapshotChange={setInboxSnapshot}
        onCommanderManualFix={onCommanderManualFix}
        onCommanderDismiss={onCommanderDismiss}
        repairSnapshot={repairSnapshot}
        onRepairSnapshotChange={setRepairSnapshot}
        onUpgradeQueueChange={setUpgradeQueue}
      />
    </>
  )
})
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
    onCouncilResearchHandoff?: (payload: CouncilResearchHandoff) => void
    threadId?: string
  }
  babyObserver?: ReactNode
  commandCenterExtras?: ReactNode
  builderExtras?: ReactNode
  redTeamPanel?: ReactNode
  gapFinderContext?: GapFinderContext
  onGapCountChange?: (count: number) => void
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
  redTeamPanel,
  gapFinderContext,
  onGapCountChange,
}: DockPanelContentProps) {
  const { setLiveMode, setEngineeringDrawerOpen } = useLiveRoomMode()

  const openBuilder = () => {
    setLiveMode('builder')
    setEngineeringDrawerOpen(true)
    onOpenEngineering?.()
  }

  return (
    <PanelErrorBoundary label={panelId}>
      {panelId === 'live-council' ? (
        <section className="space-y-2 text-[10px] tracking-wide text-slate-400">
          <p className="font-bold uppercase tracking-widest text-emerald-300">Live Council</p>
          <p>Close this panel to return focus to the council thread. Use the command console below to speak with the families.</p>
          {sessionIndicators}
        </section>
      ) : null}

      {panelId === 'command-intel' && liveEnvironment ? (
        <LiveEnvironmentPanel {...liveEnvironment} hideEvolutionPanel />
      ) : null}

      {panelId === 'operations' ? (
        <div className="space-y-3">
          <OpportunityScoutPanel />
        </div>
      ) : null}

      {panelId === 'system-health' ? (
        <div className="space-y-3">
          {gapFinderContext ? (
            <SystemHealthOperatorPanels
              gapFinderContext={gapFinderContext}
              onGapCountChange={onGapCountChange}
            />
          ) : null}
          <WarRoomEvolutionPanel onCouncilHandoff={onCouncilHandoff} />
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">AI Team Status</p>
            <ProviderRuntimePanel />
          </section>
          <RuntimeIntegrityPanel />
        </div>
      ) : null}

      {panelId === 'memory-core' ? <Phase6MemoryPanels /> : null}

      {panelId === 'analytics' ? <SignalRadarPanel /> : null}

      {panelId === 'red-team' ? (
        <div className="space-y-3">
          {redTeamPanel ?? (
            <p className="text-[10px] tracking-wide text-slate-500">Red Team review loads from the engineering lane when configured.</p>
          )}
          <RepairPacketPanel latest={latestRepairPacket ?? null} />
        </div>
      ) : null}

      {panelId === 'approvals' ? (
        <div className="space-y-3">
          <OperatorCommandEnvironment
            version="41"
            sessionIndicators={sessionIndicators ?? null}
            onOpenEngineering={openBuilder}
          />
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-yellow-200">Approvals &amp; Command Deck</p>
            <OperatorCommandDeck />
          </section>
          {commandCenterExtras}
        </div>
      ) : null}

      {panelId === 'settings' ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <WarRoomSweepPanel />
          <SchemaSweepPanel />
          <ProductionDiagnosticsPanel />
          {builderExtras}
        </div>
      ) : null}

      {babyObserver && panelId === 'live-council' ? babyObserver : null}
    </PanelErrorBoundary>
  )
})
