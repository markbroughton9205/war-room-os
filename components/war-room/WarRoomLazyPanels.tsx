'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BabyObserverNode, CouncilTable, SentinelStatusPanel } from '@/components/war-room/council'
import { PanelErrorBoundary } from '@/components/war-room/runtime/PanelErrorBoundary'

function PanelSkeleton({ label }: { label: string }) {
  return (
    <section className="mx-auto mt-14 max-w-6xl rounded border border-white/10 bg-black/25 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500">{label}</div>
      <div className="mt-2 h-20 animate-pulse rounded bg-white/5" />
    </section>
  )
}

const EconomicOperationsPanel = dynamic(
  () => import('@/components/economic/EconomicOperationsPanel').then(mod => mod.EconomicOperationsPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Economic Ops loading" /> },
)
const ProviderRuntimePanel = dynamic(
  () => import('@/components/war-room/providers/ProviderRuntimePanel').then(mod => mod.ProviderRuntimePanel),
  { ssr: false, loading: () => <PanelSkeleton label="Provider Runtime loading" /> },
)
const RuntimeIntegrityPanel = dynamic(
  () => import('@/components/war-room/runtime/RuntimeIntegrityPanel').then(mod => mod.RuntimeIntegrityPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Runtime Integrity loading" /> },
)
const ProductionDiagnosticsPanel = dynamic(
  () => import('@/components/war-room/diagnostics/ProductionDiagnosticsPanel').then(mod => mod.ProductionDiagnosticsPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Production Diagnostics loading" /> },
)
const SignalRadarPanel = dynamic(
  () => import('@/components/war-room/signals/SignalRadarPanel').then(mod => mod.SignalRadarPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Signal Radar loading" /> },
)
const RevenueEnginePanel = dynamic(
  () => import('@/components/war-room/revenue-engine/RevenueEnginePanel').then(mod => mod.RevenueEnginePanel),
  { ssr: false, loading: () => <PanelSkeleton label="Revenue Engine loading" /> },
)
const GrowthCalendarPanel = dynamic(
  () => import('@/components/war-room/growth-calendar/GrowthCalendarPanel').then(mod => mod.GrowthCalendarPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Growth Calendar loading" /> },
)
const OutcomeLedgerPanel = dynamic(
  () => import('@/components/war-room/outcomes/OutcomeLedgerPanel').then(mod => mod.OutcomeLedgerPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Outcome Ledger loading" /> },
)
const CommanderOsPanel = dynamic(
  () => import('@/components/war-room/commander/CommanderOsPanel').then(mod => mod.CommanderOsPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Commander OS loading" /> },
)
const BuildAgentDivisionPanel = dynamic(
  () => import('@/components/war-room/build-agent/BuildAgentDivisionPanel').then(mod => mod.BuildAgentDivisionPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Build Agent loading" /> },
)
const FeatureBuilderPanel = dynamic(
  () => import('@/components/war-room/feature-builder/FeatureBuilderPanel').then(mod => mod.FeatureBuilderPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Feature Builder loading" /> },
)
const RepairPacketPanel = dynamic(
  () => import('@/components/war-room/engineering/RepairPacketPanel').then(mod => mod.RepairPacketPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Repair Packets loading" /> },
)
const Phase9BLearningPanels = dynamic(
  () => import('@/components/war-room/learning/Phase9BLearningPanels').then(mod => mod.Phase9BLearningPanels),
  { ssr: false, loading: () => <PanelSkeleton label="Learning Panels loading" /> },
)
const AgentFoundryPanel = dynamic(
  () => import('@/components/war-room/agents/AgentFoundryPanel').then(mod => mod.AgentFoundryPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Agent Foundry loading" /> },
)
const AutomationGovernancePanel = dynamic(
  () => import('@/components/war-room/automation/AutomationGovernancePanel').then(mod => mod.AutomationGovernancePanel),
  { ssr: false, loading: () => <PanelSkeleton label="Automation Governance loading" /> },
)
const BabyAiAcademyPanel = dynamic(
  () => import('@/components/war-room/baby-ai/BabyAiAcademyPanel').then(mod => mod.BabyAiAcademyPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Baby Academy loading" /> },
)

function LazyPanel({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const visibleAtRef = useRef<number | null>(null)
  const [shouldMount, setShouldMount] = useState(false)

  useEffect(() => {
    if (shouldMount) return
    const node = ref.current
    if (!node) return
    if (!('IntersectionObserver' in window)) {
      const frame = globalThis.requestAnimationFrame(() => {
        visibleAtRef.current = performance.now()
        setShouldMount(true)
      })
      return () => globalThis.cancelAnimationFrame(frame)
    }
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        visibleAtRef.current = performance.now()
        setShouldMount(true)
        observer.disconnect()
      },
      { rootMargin: '700px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [shouldMount])

  useEffect(() => {
    if (!shouldMount) return
    const started = visibleAtRef.current
    if (started == null) return
    window.dispatchEvent(new CustomEvent('war-room-panel-render', {
      detail: {
        id,
        label,
        durationMs: performance.now() - started,
        at: Date.now(),
      },
    }))
  }, [id, label, shouldMount])

  return (
    <div ref={ref} data-war-room-lazy-panel={id}>
      {shouldMount ? <PanelErrorBoundary label={label}>{children}</PanelErrorBoundary> : <PanelSkeleton label={`${label} deferred`} />}
    </div>
  )
}

function CouncilSection() {
  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-white/10 pt-10">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Council</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Seating &amp; oversight</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Mock council layout — six family seats, Sentinel metrics, Baby observer node.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start lg:gap-x-8 lg:gap-y-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <CouncilTable />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <SentinelStatusPanel />
        </div>
        <div className="border-t border-white/10 pt-6 lg:col-span-2">
          <BabyObserverNode className="lg:max-w-xl" />
        </div>
      </div>
    </section>
  )
}

export function WarRoomLazyPanels() {
  return (
    <>
      <LazyPanel id="economic-ops" label="Economic Ops"><EconomicOperationsPanel /></LazyPanel>
      <LazyPanel id="provider-runtime" label="Provider Runtime"><ProviderRuntimePanel /></LazyPanel>
      <LazyPanel id="runtime-integrity" label="Runtime Integrity"><RuntimeIntegrityPanel /></LazyPanel>
      <LazyPanel id="production-diagnostics" label="Production Diagnostics"><ProductionDiagnosticsPanel /></LazyPanel>
      <LazyPanel id="signal-radar" label="Signal Radar"><SignalRadarPanel /></LazyPanel>
      <LazyPanel id="revenue-engine" label="Revenue Engine"><RevenueEnginePanel /></LazyPanel>
      <LazyPanel id="growth-calendar" label="Growth Calendar"><GrowthCalendarPanel /></LazyPanel>
      <LazyPanel id="outcome-ledger" label="Outcome Ledger"><OutcomeLedgerPanel /></LazyPanel>
      <LazyPanel id="commander-os" label="Commander OS"><CommanderOsPanel /></LazyPanel>
      <LazyPanel id="build-agent" label="Build Agent"><BuildAgentDivisionPanel /></LazyPanel>
      <LazyPanel id="feature-builder" label="Feature Builder"><FeatureBuilderPanel /></LazyPanel>
      <LazyPanel id="repair-packets" label="Repair Packets"><RepairPacketPanel /></LazyPanel>
      <LazyPanel id="learning" label="Learning Panels"><Phase9BLearningPanels /></LazyPanel>
      <LazyPanel id="agent-foundry" label="Agent Foundry"><AgentFoundryPanel /></LazyPanel>
      <LazyPanel id="automation-governance" label="Automation Governance"><AutomationGovernancePanel /></LazyPanel>
      <LazyPanel id="baby-academy" label="Baby Academy"><BabyAiAcademyPanel /></LazyPanel>
      <LazyPanel id="council-oversight" label="Council Oversight"><CouncilSection /></LazyPanel>
    </>
  )
}
