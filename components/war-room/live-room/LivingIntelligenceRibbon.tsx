'use client'

import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useState } from 'react'

import type { CouncilResearchHandoff } from '@/lib/council-research/types'
import type { CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'
import { DEFAULT_COMMANDER_LOCATION } from '@/lib/intelligence/environment/locationPolicy'
import { fetchIntelligenceRibbonData } from '@/lib/intelligence/ribbon/fetchRibbonData'
import type { IntelligenceRibbonData } from '@/lib/intelligence/ribbon/types'

import { AiTeamSegment } from './ribbon/AiTeamSegment'
import { MarketsSegment } from './ribbon/MarketsSegment'
import { NewsTickerSegment } from './ribbon/NewsTickerSegment'
import { OpportunitySegment } from './ribbon/OpportunitySegment'
import { PersonalFinanceSegment } from './ribbon/PersonalFinanceSegment'
import { SymbolicSegment } from './ribbon/SymbolicSegment'
import { WeatherSegment } from './ribbon/WeatherSegment'

const NewsIntelCommandWall = dynamic(
  () => import('@/components/intelligence/NewsIntelCommandWall').then(mod => mod.NewsIntelCommandWall),
  { ssr: false },
)

const POLL_MS = 120_000

const EMPTY_RIBBON: IntelligenceRibbonData = {
  loadedAt: '',
  headlines: [],
  weather: { status: 'unavailable', tempF: null, condition: null, tonight: null, alert: null, label: 'Live weather temporarily unavailable.' },
  markets: { status: 'unavailable', climate: 'unavailable', quotes: [], watchlistNote: null, label: 'Markets temporarily unavailable' },
  personalFinance: {
    status: 'unavailable',
    balance: null,
    recentEarnings: null,
    pipeline: null,
    missionTrigger: null,
    debtProgress: null,
    label: 'Personal finance not logged',
  },
  aiTeam: { label: 'Checking AI team…', tone: 'warn', familiesOnline: 0, familiesTotal: 0, councilNote: null },
  opportunities: { count: 0, label: 'No opportunities queued', payoutAlert: null },
  symbolic: { sign: 'Taurus', guidance: 'Ground the day in one concrete act of care.', period: 'daily' },
  urgentWarning: null,
}

export type LivingIntelligenceRibbonProps = {
  location?: CommanderLocationState
  threadId?: string
  onCouncilHandoff?: (decree: string) => void
  onCouncilResearchHandoff?: (payload: CouncilResearchHandoff) => void
  opportunityCount?: number
  urgentWarning?: string | null
  headlineOverride?: string | null
}

export const LivingIntelligenceRibbon = memo(function LivingIntelligenceRibbon({
  location = DEFAULT_COMMANDER_LOCATION,
  threadId,
  onCouncilHandoff,
  onCouncilResearchHandoff,
  opportunityCount,
  urgentWarning,
  headlineOverride,
}: LivingIntelligenceRibbonProps) {
  const [data, setData] = useState<IntelligenceRibbonData>(EMPTY_RIBBON)
  const [intelWallOpen, setIntelWallOpen] = useState(false)

  const refresh = useCallback(async () => {
    const next = await fetchIntelligenceRibbonData({
      location,
      opportunityCount,
      urgentWarning,
      headlineOverride,
    })
    setData(next)
  }, [headlineOverride, location, opportunityCount, urgentWarning])

  useEffect(() => {
    const run = () => void refresh()
    const initial = window.setTimeout(run, 0)
    const timer = window.setInterval(run, POLL_MS)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  const warning = urgentWarning ?? data.urgentWarning

  return (
    <div className="w-full" data-testid="living-intelligence-ribbon">
      <div
        className="flex w-full flex-nowrap items-stretch overflow-x-auto overscroll-x-contain"
        style={{ background: 'rgba(0,0,0,0.42)', scrollbarWidth: 'thin' }}
      >
        <RibbonBrandHeader warning={warning} />

        <NewsTickerSegment headlines={data.headlines} />
        <WeatherSegment weather={data.weather} />
        <MarketsSegment markets={data.markets} />
        <PersonalFinanceSegment finance={data.personalFinance} />
        <AiTeamSegment aiTeam={data.aiTeam} />
        <OpportunitySegment opportunities={data.opportunities} />
        <SymbolicSegment symbolic={data.symbolic} />

        <div className="sticky right-0 z-[1] flex shrink-0 items-center border-l border-yellow-900/50 bg-[rgba(4,6,10,0.96)] px-3 py-2 sm:px-4">
          <button
            type="button"
            className="whitespace-nowrap rounded border border-cyan-400/35 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-200 transition hover:bg-cyan-400/10"
            onClick={() => setIntelWallOpen(true)}
          >
            Expand Intel
          </button>
        </div>
      </div>

      {intelWallOpen ? (
        <NewsIntelCommandWall
          open={intelWallOpen}
          onClose={() => setIntelWallOpen(false)}
          location={location}
          onCouncilHandoff={onCouncilHandoff}
          onCouncilResearchHandoff={onCouncilResearchHandoff}
          threadId={threadId}
        />
      ) : null}
    </div>
  )
})

function RibbonBrandHeader({ warning }: { warning: string | null }) {
  return (
    <>
      <div className="flex min-w-[7rem] shrink-0 items-center border-r border-yellow-900/50 px-3 py-2 sm:min-w-[8rem] sm:px-4">
        <span className="text-[10px] font-bold uppercase leading-tight tracking-[0.22em] text-[#FFD700] sm:tracking-[0.3em]">
          Command Intel
        </span>
      </div>

      {warning ? (
        <div className="flex min-w-[8rem] shrink-0 animate-pulse flex-col justify-center border-r border-red-500/35 bg-red-950/25 px-3 py-2 sm:min-w-[9rem] sm:px-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-400/90">Urgent</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-red-200" title={warning}>
            {warning}
          </p>
        </div>
      ) : null}
    </>
  )
}
