import type { Metadata } from 'next'
import { BuildAgentDivisionPanel } from '@/components/war-room/build-agent/BuildAgentDivisionPanel'
import { AnalystOperationsPanel } from '@/components/war-room/analysts/AnalystOperationsPanel'
import { BabyObserverNode, CouncilTable, SentinelStatusPanel } from '@/components/war-room/council'
import { EconomicOperationsPanel } from '@/components/economic/EconomicOperationsPanel'
import { Phase3WarRoomPanels } from '@/components/war-room/phase3/Phase3WarRoomPanels'
import { Phase9BLearningPanels } from '@/components/war-room/learning/Phase9BLearningPanels'
import { AgentFoundryPanel } from '@/components/war-room/agents/AgentFoundryPanel'
import { AutomationGovernancePanel } from '@/components/war-room/automation/AutomationGovernancePanel'
import { BabyAiAcademyPanel } from '@/components/war-room/baby-ai/BabyAiAcademyPanel'
import { FeatureBuilderPanel } from '@/components/war-room/feature-builder/FeatureBuilderPanel'
import { RevenueEnginePanel } from '@/components/war-room/revenue-engine/RevenueEnginePanel'
import { KpiGrid } from '@/components/war-room/KpiGrid'
import { WarRoomShell } from '@/components/war-room/WarRoomShell'

export const metadata: Metadata = {
  title: 'War Room OS — Command',
  description: 'War Room OS command dashboard — council layout and panels are UI shells until wired to live data.',
}

export default function WarRoomDashboardPage() {
  return (
    <WarRoomShell>
      <Phase3WarRoomPanels />
      <KpiGrid />
      <AnalystOperationsPanel compact />
      <EconomicOperationsPanel />
      <RevenueEnginePanel />
      <BuildAgentDivisionPanel />
      <FeatureBuilderPanel />
      <Phase9BLearningPanels />
      <AgentFoundryPanel />
      <AutomationGovernancePanel />
      <BabyAiAcademyPanel />
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
    </WarRoomShell>
  )
}
