'use client'

import { memo, useCallback, useEffect, useState } from 'react'
import { PlainStatusCard } from './PlainStatusCard'
import { DEFAULT_COMMANDER_LOCATION } from '@/lib/intelligence/environment/locationPolicy'
import { buildNewsIntelWall, fetchNewsIntelWallData } from '@/lib/intelligence/newsIntelWall'
import { fetchJsonSafe, sanitizeConnectionError } from '@/lib/war-room/sanitizeConnectionError'

const POLL_MS = 120_000

type CanonicalStatusPayload = {
  subsystems?: { id: string; health: string }[]
  providers?: { connectionStatus: string }[]
}

type OpportunitiesPayload = {
  opportunities?: unknown[]
}

function providerSummary(providers: CanonicalStatusPayload['providers']): { label: string; tone: 'ok' | 'warn' | 'danger' } {
  const rows = providers ?? []
  if (!rows.length) return { label: 'Checking team…', tone: 'warn' }
  const online = rows.filter(p => p.connectionStatus === 'online' || p.connectionStatus === 'standby').length
  if (online === rows.length) return { label: `${online} AI teams ready`, tone: 'ok' }
  if (online > 0) return { label: `${online} of ${rows.length} teams ready`, tone: 'warn' }
  return { label: 'Teams need attention', tone: 'danger' }
}

function marketLabel(subsystems: CanonicalStatusPayload['subsystems']): string {
  const radar = subsystems?.find(s => s.id === 'signal_radar')
  if (!radar) return 'Checking markets'
  if (/healthy|verified/i.test(radar.health)) return 'Steady'
  if (/degraded|advisory/i.test(radar.health)) return 'Mixed signals'
  return 'Limited data'
}

export type TopIntelBarProps = {
  opportunityCount?: number
  urgentWarning?: string | null
  headlineOverride?: string | null
  weatherOverride?: string | null
}

export const TopIntelBar = memo(function TopIntelBar({
  opportunityCount: opportunityCountProp,
  urgentWarning: urgentWarningProp,
  headlineOverride,
  weatherOverride,
}: TopIntelBarProps) {
  const [headline, setHeadline] = useState('Gathering live briefing…')
  const [weather] = useState('Weather unavailable')
  const [market, setMarket] = useState('Checking')
  const [provider, setProvider] = useState<{ label: string; tone: 'ok' | 'warn' | 'danger' }>({
    label: 'Checking AI teams…',
    tone: 'warn',
  })
  const [opportunityCount, setOpportunityCount] = useState(opportunityCountProp ?? 0)
  const [urgentWarning, setUrgentWarning] = useState<string | null>(urgentWarningProp ?? null)
  const [fetchNote, setFetchNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setFetchNote(null)
    const canonical = await fetchJsonSafe<CanonicalStatusPayload>('/api/runtime/canonical-status', { cache: 'no-store' })
    if (canonical.ok) {
      setProvider(providerSummary(canonical.data.providers))
      setMarket(marketLabel(canonical.data.subsystems))
      const council = canonical.data.subsystems?.find(s => s.id === 'approval_gate')
      if (council && /unavailable|blocked/i.test(council.health)) {
        setUrgentWarning(prev => prev ?? 'Council approvals need review')
      }
    } else {
      setFetchNote(canonical.error)
      setProvider({ label: 'Fallback mode', tone: 'warn' })
    }

    if (opportunityCountProp == null) {
      const opp = await fetchJsonSafe<OpportunitiesPayload>('/api/income/opportunities', { cache: 'no-store' })
      if (opp.ok) setOpportunityCount(opp.data.opportunities?.length ?? 0)
    }

    if (!headlineOverride) {
      try {
        const { newsCards, signals } = await fetchNewsIntelWallData(DEFAULT_COMMANDER_LOCATION)
        const wall = buildNewsIntelWall({ newsCards, signals })
        const topStory =
          wall.sections.top_stories[0]
          ?? wall.sections.world_watch[0]
          ?? wall.sections.usa_watch[0]
        if (topStory?.headline) setHeadline(topStory.headline)
        else if (signals[0]?.title) setHeadline(signals[0].title)
        else setHeadline('No headline yet — open News & Intel')
      } catch (error) {
        setHeadline(sanitizeConnectionError(error, 'Briefing unavailable in fallback mode'))
      }
    }
  }, [headlineOverride, opportunityCountProp])

  useEffect(() => {
    if (opportunityCountProp != null) setOpportunityCount(opportunityCountProp)
  }, [opportunityCountProp])

  useEffect(() => {
    if (urgentWarningProp != null) setUrgentWarning(urgentWarningProp)
  }, [urgentWarningProp])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const displayHeadline = headlineOverride ?? headline
  const displayWeather = weatherOverride ?? weather
  const warningText = urgentWarning ?? (fetchNote ? sanitizeConnectionError(fetchNote) : null)

  return (
    <div className="flex flex-col gap-2 px-4 py-2 sm:px-6" data-testid="top-intel-bar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#FFD700]">Live News &amp; Info</span>
        {warningText ? (
          <span className="rounded border border-red-500/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-red-300">
            {warningText}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <PlainStatusCard label="Headline" value={displayHeadline} />
        <PlainStatusCard label="Weather" value={displayWeather} />
        <PlainStatusCard label="Markets" value={market} />
        <PlainStatusCard label="AI team" value={provider.label} tone={provider.tone} />
        <PlainStatusCard
          label="Opportunities"
          value={opportunityCount === 0 ? 'None queued' : `${opportunityCount} open`}
          tone={opportunityCount > 0 ? 'ok' : 'neutral'}
        />
      </div>
    </div>
  )
})
