import type { CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'
import { buildHoroscopeSnapshot } from '@/lib/intelligence/environment/horoscopeEnvironment'
import type { LiveEnvironmentDashboardPayload } from '@/lib/intelligence/environment/liveEnvironmentTypes'
import { buildNewsIntelWall, fetchNewsIntelWallData } from '@/lib/intelligence/newsIntelWall'
import type { OperatorDeckSnapshot } from '@/lib/operator/deckTypes'
import { fetchJsonSafe, sanitizeConnectionError } from '@/lib/war-room/sanitizeConnectionError'

type CanonicalStatusPayload = {
  subsystems?: { id: string; health: string; label?: string }[]
  providers?: { connectionStatus: string; health?: string }[]
  summary?: { health?: string }
}

import {
  buildAiTeamSlice,
  buildMarketsSlice,
  buildOpportunitiesSlice,
  buildPersonalFinanceSlice,
  buildSymbolicSlice,
  buildWeatherSlice,
  storyToRibbonHeadline,
} from './formatters'
import type { IntelligenceRibbonData } from './types'

type OpportunitiesPayload = {
  opportunities?: Array<{ status?: string; estimatedPayout?: number | null; title?: string }>
}

function collectHeadlines(
  location: CommanderLocationState,
): Promise<IntelligenceRibbonData['headlines']> {
  return fetchNewsIntelWallData(location)
    .then(({ newsCards, signals }) => {
      const wall = buildNewsIntelWall({ newsCards, signals })
      const pool = [
        ...wall.sections.top_stories,
        ...wall.sections.geopolitics_war,
        ...wall.sections.ai_tech_watch,
        ...wall.sections.economy_watch,
        ...wall.sections.akron_watch,
        ...wall.sections.world_watch,
        ...wall.sections.usa_watch,
        ...wall.sections.actionable_signals,
      ]
      const seen = new Set<string>()
      const headlines = []
      for (const story of pool.sort((a, b) => b.leverageScore - a.leverageScore)) {
        const key = (story.url ?? story.headline).toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        headlines.push(storyToRibbonHeadline(story))
        if (headlines.length >= 12) break
      }
      return headlines
    })
    .catch(() => [] as IntelligenceRibbonData['headlines'])
}

export async function fetchIntelligenceRibbonData(args: {
  location: CommanderLocationState
  opportunityCount?: number | null
  urgentWarning?: string | null
  headlineOverride?: string | null
}): Promise<IntelligenceRibbonData> {
  const { location, opportunityCount, urgentWarning, headlineOverride } = args

  const [canonicalRes, envRes, deckRes, oppRes, headlines] = await Promise.all([
    fetchJsonSafe<CanonicalStatusPayload>('/api/runtime/canonical-status', { cache: 'no-store' }),
    fetch('/api/environment/dashboard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location }),
      cache: 'no-store',
    }).catch(() => null),
    fetchJsonSafe<OperatorDeckSnapshot>('/api/operator/deck', { cache: 'no-store' }),
    opportunityCount == null
      ? fetchJsonSafe<OpportunitiesPayload>('/api/income/opportunities', { cache: 'no-store' })
      : Promise.resolve(null),
    headlineOverride ? Promise.resolve([]) : collectHeadlines(location),
  ])

  let envPayload: LiveEnvironmentDashboardPayload | null = null
  if (envRes?.ok) {
    try {
      envPayload = (await envRes.json()) as LiveEnvironmentDashboardPayload
    } catch {
      envPayload = null
    }
  }

  const canonical = canonicalRes.ok ? canonicalRes.data : null
  const aiTeam = buildAiTeamSlice(canonical)
  const weather = buildWeatherSlice(envPayload?.weather)
  const markets = buildMarketsSlice(
    envPayload?.finance?.quotes ?? [],
    envPayload?.finance?.status === 'available' ? 'available' : 'unavailable',
  )
  const personalFinance = buildPersonalFinanceSlice(deckRes.ok ? deckRes.data : null)

  let oppCount = opportunityCount ?? 0
  let payoutAlert: string | null = null
  if (opportunityCount == null && oppRes && 'ok' in oppRes && oppRes.ok) {
    const rows = oppRes.data.opportunities ?? []
    oppCount = rows.length
    const payout = rows.find(row => typeof row.estimatedPayout === 'number' && row.estimatedPayout > 0)
    if (payout?.title) payoutAlert = `Payout watch: ${payout.title}`
  }

  const symbolic = buildSymbolicSlice(buildHoroscopeSnapshot(undefined, 'symbolic', false, 'daily'))

  let resolvedHeadlines = headlines
  if (headlineOverride) {
    resolvedHeadlines = [
      {
        id: 'override',
        headline: headlineOverride,
        source: 'Council',
        publishedAt: null,
        category: 'Live',
        intelligenceCategory: 'uncategorized',
        urgency: 'elevated',
      },
    ]
  } else if (!resolvedHeadlines.length) {
    resolvedHeadlines = [
      {
        id: 'empty',
        headline: 'No headline yet — expand intel',
        source: 'War Room',
        publishedAt: null,
        category: 'Intel',
        intelligenceCategory: 'uncategorized',
        urgency: 'normal',
      },
    ]
  }

  const internalUrgent =
    aiTeam.councilNote && /need review|degraded/i.test(aiTeam.councilNote) ? aiTeam.councilNote : null
  const weatherUrgent = weather.alert ? `Weather alert: ${weather.alert}` : null

  return {
    loadedAt: new Date().toISOString(),
    headlines: resolvedHeadlines,
    weather,
    markets,
    personalFinance,
    aiTeam,
    opportunities: buildOpportunitiesSlice(oppCount, { payoutAlert }),
    symbolic,
    urgentWarning: urgentWarning ?? internalUrgent ?? weatherUrgent ?? null,
  }
}

export function ribbonRefreshErrorMessage(error: unknown): string {
  return sanitizeConnectionError(error, 'Briefing unavailable in fallback mode')
}
