'use client'

import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useState } from 'react'

import type { CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'
import type { LiveEnvironmentDashboardPayload } from '@/lib/intelligence/environment/liveEnvironmentTypes'
import { DEFAULT_COMMANDER_LOCATION } from '@/lib/intelligence/environment/locationPolicy'
import { buildNewsIntelWall, fetchNewsIntelWallData } from '@/lib/intelligence/newsIntelWall'
import type { CouncilResearchHandoff } from '@/lib/council-research/types'
import { matrixStatus } from '@/lib/ui/matrixStatusBus'
import { fetchJsonSafe, sanitizeConnectionError } from '@/lib/war-room/sanitizeConnectionError'

const NewsIntelCommandWall = dynamic(
  () => import('@/components/intelligence/NewsIntelCommandWall').then(mod => mod.NewsIntelCommandWall),
  { ssr: false },
)

const POLL_MS = 120_000

type CanonicalStatusPayload = {
  subsystems?: { id: string; health: string }[]
  providers?: { connectionStatus: string }[]
}

type OpportunitiesPayload = {
  opportunities?: unknown[]
}

type SegmentTone = 'neutral' | 'ok' | 'warn' | 'danger'

const TONE_TEXT: Record<SegmentTone, string> = {
  neutral: 'text-slate-200',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  danger: 'text-red-300',
}

function providerSummary(providers: CanonicalStatusPayload['providers']): { label: string; tone: SegmentTone } {
  const rows = providers ?? []
  if (!rows.length) return { label: 'Checking AI team…', tone: 'warn' }
  const online = rows.filter(p => p.connectionStatus === 'online' || p.connectionStatus === 'standby').length
  if (online === rows.length) return { label: 'AI team ready', tone: 'ok' }
  if (online > 0) return { label: 'Some teams need attention', tone: 'warn' }
  return { label: 'Teams need attention', tone: 'danger' }
}

function marketLabel(subsystems: CanonicalStatusPayload['subsystems']): string {
  const radar = subsystems?.find(s => s.id === 'signal_radar')
  if (!radar) return 'Market data unavailable'
  if (/healthy|verified/i.test(radar.health)) return 'Markets steady'
  if (/degraded|advisory/i.test(radar.health)) return 'Market signals mixed'
  return 'Market data unavailable'
}

function weatherRibbonLabel(weather: LiveEnvironmentDashboardPayload['weather'] | null): string {
  if (!weather || weather.status !== 'available') return 'Weather reconnecting'
  const parts: string[] = []
  if (weather.currentTempF != null) parts.push(`${Math.round(weather.currentTempF)}°`)
  const condition = weather.condition?.trim()
  if (condition && !/provider not loaded|unavailable/i.test(condition)) parts.push(condition)
  return parts.length ? parts.join(' · ') : 'Weather available'
}

function RibbonSegment({
  label,
  value,
  tone = 'neutral',
  className = '',
}: {
  label: string
  value: string
  tone?: SegmentTone
  className?: string
}) {
  return (
    <div
      className={`flex min-w-[9.5rem] shrink-0 flex-1 flex-col justify-center border-r border-white/10 px-4 py-2.5 sm:min-w-[11rem] ${className}`}
      title={value}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-base font-semibold leading-snug ${TONE_TEXT[tone]}`}>{value}</p>
    </div>
  )
}

export type TopIntelRibbonProps = {
  location?: CommanderLocationState
  threadId?: string
  onCouncilHandoff?: (decree: string) => void
  onCouncilResearchHandoff?: (payload: CouncilResearchHandoff) => void
  opportunityCount?: number
  urgentWarning?: string | null
  headlineOverride?: string | null
  weatherOverride?: string | null
  missionStatus?: string
  councilHealthLabel?: string
  activityFeedLabel?: string
}

export const TopIntelRibbon = memo(function TopIntelRibbon({
  location = DEFAULT_COMMANDER_LOCATION,
  threadId,
  onCouncilHandoff,
  onCouncilResearchHandoff,
  opportunityCount: opportunityCountProp,
  urgentWarning: urgentWarningProp,
  headlineOverride,
  weatherOverride,
  missionStatus: missionStatusProp,
  councilHealthLabel: councilHealthLabelProp,
  activityFeedLabel: activityFeedLabelProp,
}: TopIntelRibbonProps) {
  const [headline, setHeadline] = useState('Open Intel for latest stories')
  const [weather, setWeather] = useState('Weather reconnecting')
  const [market, setMarket] = useState('Market data unavailable')
  const [provider, setProvider] = useState<{ label: string; tone: SegmentTone }>({
    label: 'Checking AI team…',
    tone: 'warn',
  })
  const [fetchedOpportunityCount, setFetchedOpportunityCount] = useState(0)
  const [internalUrgent, setInternalUrgent] = useState<string | null>(null)
  const [fetchNote, setFetchNote] = useState<string | null>(null)
  const [intelWallOpen, setIntelWallOpen] = useState(false)

  const refresh = useCallback(async () => {
    setFetchNote(null)
    const canonical = await fetchJsonSafe<CanonicalStatusPayload>('/api/runtime/canonical-status', { cache: 'no-store' })
    if (canonical.ok) {
      setProvider(providerSummary(canonical.data.providers))
      setMarket(marketLabel(canonical.data.subsystems))
      const council = canonical.data.subsystems?.find(s => s.id === 'approval_gate')
      if (council && /unavailable|blocked/i.test(council.health)) {
        setInternalUrgent(prev => prev ?? 'Council approvals need review')
      }
    } else {
      setFetchNote(canonical.error)
      setProvider({ label: 'AI team in fallback mode', tone: 'warn' })
    }

    if (!weatherOverride) {
      try {
        const res = await fetch('/api/environment/dashboard', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ location }),
          cache: 'no-store',
        })
        if (!res.ok) {
          setWeather('Weather reconnecting')
        } else {
          const payload = (await res.json()) as LiveEnvironmentDashboardPayload
          setWeather(weatherRibbonLabel(payload.weather))
        }
      } catch {
        setWeather('Weather reconnecting')
      }
    }

    if (opportunityCountProp == null) {
      const opp = await fetchJsonSafe<OpportunitiesPayload>('/api/income/opportunities', { cache: 'no-store' })
      if (opp.ok) setFetchedOpportunityCount(opp.data.opportunities?.length ?? 0)
    }

    if (!headlineOverride) {
      try {
        const { newsCards, signals } = await fetchNewsIntelWallData(location)
        const wall = buildNewsIntelWall({ newsCards, signals })
        const topStory =
          wall.sections.top_stories[0]
          ?? wall.sections.world_watch[0]
          ?? wall.sections.usa_watch[0]
        if (topStory?.headline) setHeadline(topStory.headline)
        else if (signals[0]?.title) setHeadline(signals[0].title)
        else setHeadline('Open Intel for latest stories')
      } catch {
        setHeadline('Open Intel for latest stories')
      }
    }
  }, [headlineOverride, location, opportunityCountProp, weatherOverride])

  useEffect(() => {
    const run = () => void refresh()
    const initial = window.setTimeout(run, 0)
    const timer = window.setInterval(run, POLL_MS)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  const opportunityCount = opportunityCountProp ?? fetchedOpportunityCount
  const displayHeadline = headlineOverride ?? headline
  const displayWeather = weatherOverride ?? weather
  const warningText =
    urgentWarningProp ?? internalUrgent ?? (fetchNote ? sanitizeConnectionError(fetchNote) : null)
  const opportunityLabel =
    opportunityCount === 0 ? 'No opportunities queued' : `${opportunityCount} opportunit${opportunityCount === 1 ? 'y' : 'ies'} open`
  const missionStatus = missionStatusProp ?? opportunityLabel
  const councilHealth = councilHealthLabelProp ?? provider.label
  const activityFeed = activityFeedLabelProp ?? (opportunityCount === 0 ? 'No opportunities queued' : opportunityLabel)

  return (
    <div className="w-full" data-testid="top-intel-ribbon">
      <div
        className="flex w-full flex-nowrap items-stretch overflow-x-auto overscroll-x-contain"
        style={{ background: 'rgba(0,0,0,0.42)', scrollbarWidth: 'thin' }}
      >
        <div className="flex min-w-[7.5rem] shrink-0 items-center border-r border-yellow-900/50 px-3 py-2 sm:min-w-[8.5rem] sm:px-4">
          <span className="text-[10px] font-bold uppercase leading-tight tracking-[0.28em] text-[#FFD700] sm:tracking-[0.35em]">
            Live News &amp; Info
          </span>
        </div>

        {warningText ? (
          <div className="flex min-w-[8.5rem] shrink-0 flex-col justify-center border-r border-red-500/35 bg-red-950/25 px-4 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-400/90">Urgent</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-red-200" title={warningText}>
              {warningText}
            </p>
          </div>
        ) : null}

        <RibbonSegment label="Live News" value={displayHeadline} className="min-w-[12rem] flex-[1.4] sm:min-w-[14rem]" />
        <RibbonSegment
          label="Weather"
          value={/unavailable|reconnecting/i.test(displayWeather) ? 'Weather reconnecting' : displayWeather}
        />
        <RibbonSegment
          label="Markets"
          value={/unavailable|limited|checking/i.test(market) ? 'Market data unavailable' : market}
        />
        <RibbonSegment label="Mission Status" value={missionStatus} tone="warn" />
        <RibbonSegment
          label="Council Health"
          value={councilHealth}
          tone={councilHealthLabelProp ? (councilHealth === 'Ready' ? 'ok' : 'warn') : provider.tone}
        />
        <RibbonSegment label="Activity Feed" value={activityFeed} tone={opportunityCount > 0 ? 'ok' : 'neutral'} />

        <div className="sticky right-0 z-[1] flex shrink-0 items-center border-l border-yellow-900/50 bg-[rgba(4,6,10,0.96)] px-3 py-2 sm:px-4">
          <button
            type="button"
            className="whitespace-nowrap rounded border border-cyan-400/35 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-200 transition hover:bg-cyan-400/10"
            onClick={() => {
              matrixStatus('working', 'Expanding intel wall…')
              setIntelWallOpen(true)
              matrixStatus('success', 'Intel wall expanded')
            }}
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
