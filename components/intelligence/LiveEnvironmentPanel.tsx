'use client'

import { memo, useEffect, useMemo, useState } from 'react'

import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { ConfigurationSweep } from '@/lib/configuration/configurationHealth'
import type { ProviderConfigStatus } from '@/lib/configuration/providerConfigStatus'
import type { CommanderLocationState, LocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { describeLocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { buildHoroscopeSnapshot, type AstrologyInterpretationMode, type HoroscopePeriod } from '@/lib/intelligence/environment/horoscopeEnvironment'
import { familyTipsForPanel, type FamilyTip } from '@/lib/familyTips'
import type {
  EnvironmentSetupGuidance,
  FinanceDashboardSnapshot,
  LiveEnvironmentDashboardPayload,
  NewsDashboardCard,
  WeatherDashboardSnapshot,
} from '@/lib/intelligence/environment/liveEnvironmentTypes'

type ImprovementStat = {
  label: string
  value: string
  detail: string
  color: string
}

type CouncilHandoffAction = 'ask_council' | 'investigate' | 'send_to_analysts' | 'create_opportunity'

type CommanderSuggestion = {
  suggestedMove: string
  whyItMatters: string
  expectedBenefit: string
  nextAction: string
  relatedPanel: string
  familySource: string
  decree: string
}

const EMPTY_NEWS_CARDS: NewsDashboardCard[] = []
const HOROSCOPE_PERIODS: HoroscopePeriod[] = ['daily', 'weekly', 'monthly', 'yearly']
const LOCAL_INTELLIGENCE_QUERIES = [
  'Akron news',
  'Summit County alerts',
  'local economy',
  'business signals',
  'weather alerts',
  'traffic',
  'public safety',
  'events',
]

function modeLabel(mode: LocationMode): string {
  if (mode === 'city_only') return 'City'
  if (mode === 'precise_temporary') return 'Precise temp'
  return mode.replace(/_/g, ' ')
}

function providerStatusLabel(provider: ProviderConfigStatus | undefined): string {
  if (!provider) return 'checking provider setup'
  return provider.status.replaceAll('_', ' ')
}

function providerStatusColor(provider: ProviderConfigStatus | undefined): string {
  if (!provider) return '#64748B'
  if (provider.status === 'ready' || provider.status === 'configured') return '#34D399'
  if (provider.status === 'degraded') return '#FBBF24'
  if (provider.status === 'disabled_by_operator') return '#A78BFA'
  return '#FB923C'
}

function weatherStateLabel(state: WeatherDashboardSnapshot['providerState']): string {
  return state.replaceAll('_', ' ')
}

function weatherStateColor(state: WeatherDashboardSnapshot['providerState']): string {
  if (state === 'configured_and_live') return '#34D399'
  if (state === 'configured_but_fetch_failed') return '#FBBF24'
  return '#FB923C'
}

function isProviderReady(provider: ProviderConfigStatus | undefined): boolean {
  return provider?.status === 'ready' || provider?.status === 'configured'
}

function providerSetupHint(provider: ProviderConfigStatus | undefined, fallback: string): string {
  if (!provider) return fallback
  const envNames = [...provider.requiredEnvVars, ...provider.optionalEnvVars].join(', ') || 'no env vars registered'
  const aliasDetail = provider.preferredEnvName
    ? ` Preferred env: ${provider.preferredEnvName}. Alias detected: ${String(provider.aliasDetected)}. Configured: ${String(provider.configured)}.${provider.aliasRecommendation ? ` ${provider.aliasRecommendation}` : ''}`
    : ''
  if (provider.status === 'ready' || provider.status === 'configured') {
    return `${provider.name}: configured. ${provider.lastCheckResult}${aliasDetail}`
  }
  return `${provider.name}: ${provider.recommendedNextAction} Env names: ${envNames}.${aliasDetail}`
}

function setupGuidanceText(setup: EnvironmentSetupGuidance | undefined, fallback: string): string {
  if (!setup) return fallback
  const aliasDetail = setup.preferredEnvName
    ? ` Preferred env: ${setup.preferredEnvName}. Alias detected: ${String(setup.aliasDetected)}. Configured: ${String(setup.configured)}.${setup.aliasRecommendation ? ` ${setup.aliasRecommendation}` : ''}`
    : ''
  return `${setup.blockedFeature}: ${setup.recommendedSetup} Env names: ${setup.envVarNames.join(', ')}.${aliasDetail}`
}

function formatTemp(value: number | null): string {
  return value === null ? '--' : `${Math.round(value)}F`
}

function formatPercent(value: number | null): string {
  return value === null ? '--' : `${Math.round(value)}%`
}

function formatSignedNumber(value: number | null): string {
  if (value === null) return '--'
  return `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function formatPercentMovement(value: number | null): string {
  if (value === null) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatPrice(value: number | null, currency: string | null): string {
  if (value === null) return '--'
  return `${currency ?? 'USD'} ${value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 2 : 4 })}`
}

function changeColor(value: number | null): string {
  if (value === null) return '#94A3B8'
  if (value > 0) return '#34D399'
  if (value < 0) return '#FB7185'
  return '#94A3B8'
}

function marketDirectionText(direction: FinanceDashboardSnapshot['quotes'][number]['direction']): string {
  if (direction === 'up') return 'advancing'
  if (direction === 'down') return 'pulling back'
  if (direction === 'flat') return 'holding flat'
  return 'movement unavailable'
}

function displaySymbol(symbol: string): string {
  if (symbol === 'BTC/USD') return 'BTC'
  return symbol
}

function marketInterpretation(quote: FinanceDashboardSnapshot['quotes'][number]): string {
  const symbol = displaySymbol(quote.symbol)
  if (quote.direction === 'unknown') return `${symbol} price is live, but session movement was not returned.`
  if (quote.direction === 'flat') return `${symbol} holding flat in the latest provider quote.`
  if (symbol === 'GLD') return quote.direction === 'up' ? 'Gold bid is strengthening today.' : 'Gold pulling back today.'
  if (symbol === 'SPY' || symbol === 'QQQ') return quote.direction === 'up' ? 'Risk sentiment strengthening.' : 'Risk sentiment weakening.'
  if (symbol === 'BTC') return quote.direction === 'up' ? 'Bitcoin momentum firming.' : 'Bitcoin momentum cooling.'
  return `${symbol} ${marketDirectionText(quote.direction)} in the latest quote.`
}

function weatherIcon(condition: string, status: WeatherDashboardSnapshot['status']): string {
  if (status !== 'available') return '◇'
  const normalized = condition.toLowerCase()
  if (normalized.includes('storm') || normalized.includes('thunder')) return '⚡'
  if (normalized.includes('rain') || normalized.includes('drizzle') || normalized.includes('shower')) return '☂'
  if (normalized.includes('snow') || normalized.includes('sleet') || normalized.includes('ice')) return '✦'
  if (normalized.includes('cloud') || normalized.includes('overcast')) return '☁'
  if (normalized.includes('clear') || normalized.includes('sun')) return '☼'
  if (normalized.includes('fog') || normalized.includes('mist') || normalized.includes('haze')) return '≋'
  return '◐'
}

function weatherConditionText(weather: WeatherDashboardSnapshot): string {
  if (weather.status !== 'available') return 'Weather feed temporarily unavailable.'
  return weather.condition
}

function weatherForecastSummary(weather: WeatherDashboardSnapshot): string {
  if (weather.status !== 'available') return 'Forecast will resume when a configured source returns data.'
  if (weather.alerts.length) return `${weather.alerts.length} active weather alert${weather.alerts.length === 1 ? '' : 's'} from the source.`
  const today = weather.dailyForecast[0]
  if (today) {
    return `${today.label}: ${today.condition}${today.precipitationChance !== null ? `, ${formatPercent(today.precipitationChance)} precipitation` : ''}.`
  }
  const nextHour = weather.hourlyForecast[0]
  if (nextHour) return `Next window: ${nextHour.condition}${nextHour.tempF !== null ? ` near ${formatTemp(nextHour.tempF)}` : ''}.`
  return 'Current conditions returned; extended forecast not included by the source.'
}

function localSignalState(args: {
  sourceNetworkProvider: ProviderConfigStatus | undefined
  localSourceProvider: ProviderConfigStatus | undefined
  weakSignals: number
  localCards: number
}): 'live_results' | 'feeds_online' | 'no_results_yet' | 'degraded' | 'missing_feeds' {
  if (args.localCards > 0 || args.weakSignals > 0) return 'live_results'
  if (isProviderReady(args.sourceNetworkProvider) || isProviderReady(args.localSourceProvider)) return 'feeds_online'
  if (!args.sourceNetworkProvider && !args.localSourceProvider) return 'no_results_yet'
  if (args.localSourceProvider?.status === 'missing_provider') return 'missing_feeds'
  return 'degraded'
}

function localSignalLabel(state: ReturnType<typeof localSignalState>): string {
  return state.replaceAll('_', ' ')
}

function localSignalSummary(state: ReturnType<typeof localSignalState>, weakSignals: number): string {
  if (state === 'live_results') return weakSignals > 0 ? `${weakSignals} Akron/Summit signal${weakSignals === 1 ? '' : 's'} surfaced in current intelligence.` : 'Source-backed local results are available.'
  if (state === 'feeds_online') return 'Akron/Summit watch is online and scanning for useful local movement.'
  if (state === 'no_results_yet') return 'Akron/Summit watch is armed; no local results returned yet.'
  if (state === 'missing_feeds') return 'Add local feeds or enable search to strengthen Akron/Summit coverage.'
  return 'Local coverage degraded; diagnostics show source readiness.'
}

function buildCouncilDecree(action: CouncilHandoffAction, base: string): string {
  if (action === 'investigate') return `${base} Include verified, emerging, contradictions, unknowns, and source links.`
  if (action === 'send_to_analysts') return `Analysts, review this Live Environment signal and produce a concise operational brief: ${base}`
  if (action === 'create_opportunity') return `Opportunity Scout, turn this Live Environment signal into vetted opportunity candidates with payout/risk/next action: ${base}`
  return base
}

function buildCommanderSuggestion(args: {
  weather: WeatherDashboardSnapshot
  finance: FinanceDashboardSnapshot
  activeNews: NewsDashboardCard | null
  signalState: ReturnType<typeof localSignalState>
  missingProviders: number
  pendingActions: number
}): CommanderSuggestion {
  if (args.signalState === 'live_results' || args.activeNews?.category === 'local' || args.activeNews?.category === 'regional') {
    return {
      suggestedMove: 'Investigate Akron local opportunity signals.',
      whyItMatters: 'Local movement is closest to execution: business openings, public safety, weather, events, and community activity can change timing.',
      expectedBenefit: 'A verified local brief the Council can convert into income, logistics, or family planning next steps.',
      nextAction: 'Ask Grok to gather local signals and Gemini to separate verified facts from unknowns.',
      relatedPanel: 'Live Council / Analysts',
      familySource: 'Grok Family',
      decree: 'Grok, investigate Akron local business and opportunity signals and report verified, emerging, contradictions, and unknowns.',
    }
  }
  if (args.finance.status === 'available') {
    return {
      suggestedMove: 'Use market context before income moves.',
      whyItMatters: 'GLD, SPY, BTC, and QQQ can frame risk mood, but they should not trigger automatic trading decisions.',
      expectedBenefit: 'Cleaner timing context for opportunity scouting and transport/business decisions.',
      nextAction: 'Ask ChatGPT to translate market movement into non-trading operational considerations.',
      relatedPanel: 'Market Feed / Opportunity Scout',
      familySource: 'ChatGPT Family',
      decree: 'ChatGPT, use current GLD, SPY, BTC, and QQQ movement as context for War Room operations, not trading advice, and recommend one grounded next move.',
    }
  }
  if (args.weather.status !== 'available') {
    return {
      suggestedMove: 'Stabilize weather intelligence.',
      whyItMatters: 'Weather affects local travel, family timing, public safety, and event planning.',
      expectedBenefit: 'Reliable Akron/Summit operating context before local decisions.',
      nextAction: 'Ask Claude to review weather provider readiness and NOAA fallback status.',
      relatedPanel: 'Diagnostics / System Health',
      familySource: 'Claude Family',
      decree: 'Claude, review Live Environment weather provider readiness, NOAA fallback status, and the smallest safe fix without exposing secrets.',
    }
  }
  if (args.pendingActions > 0 || args.missingProviders > 0) {
    return {
      suggestedMove: 'Clear blockers before expanding scope.',
      whyItMatters: 'Pending approvals and missing providers can make the Council overpromise.',
      expectedBenefit: 'A tighter action list grounded in current runtime readiness.',
      nextAction: 'Ask Red Team to identify the most important blocker and approval gate.',
      relatedPanel: 'Diagnostics / Approvals',
      familySource: 'Red Team',
      decree: 'Red Team, inspect current blockers, missing providers, and pending approvals. Recommend the safest next action only.',
    }
  }
  return {
    suggestedMove: 'Run a concise operating brief.',
    whyItMatters: 'Weather, news, local signals, markets, memory, and provider state are most useful when turned into one decision.',
    expectedBenefit: 'One clear move for the next War Room cycle.',
    nextAction: 'Ask the Council for a short verified brief.',
    relatedPanel: 'Live Council',
    familySource: 'ChatGPT Family',
    decree: 'ChatGPT, summarize the current Live Environment into one suggested move, why it matters, expected benefit, and next action.',
  }
}

function buildFallbackWeather(location: CommanderLocationState): WeatherDashboardSnapshot {
  const locationLabel =
    location.mode === 'off'
      ? 'Location off'
      : location.neighborhood && location.mode === 'neighborhood'
        ? location.neighborhood
        : location.city ?? 'City not set'

  return {
    status: 'unavailable',
    providerState: 'missing_provider',
    provider: 'not loaded',
    locationLabel,
    currentTempF: null,
    condition: 'Weather provider not loaded',
    highF: null,
    lowF: null,
    precipitationChance: null,
    wind: null,
    alerts: [],
    hourlyForecast: [],
    dailyForecast: [],
    freshness: 'unknown',
    fetchedAt: null,
    source: 'Live Environment dashboard route',
    detail: 'Waiting for the server-side weather adapter.',
  }
}

function buildFallbackFinance(): FinanceDashboardSnapshot {
  return {
    status: 'unavailable',
    provider: 'not loaded',
    quotes: [],
    fetchedAt: null,
    freshness: 'unknown',
    source: 'Live Environment dashboard route',
    detail: 'Waiting for the server-side finance adapter.',
  }
}

function statList(args: {
  configurationSweep: ConfigurationSweep | null
  liveResearchHud: LiveResearchClientUi | null
  dashboard: LiveEnvironmentDashboardPayload | null
}): ImprovementStat[] {
  const configured = args.configurationSweep?.summary.totalProvidersConfigured ?? 0
  const total = args.configurationSweep?.summary.totalProviders ?? 0
  const missing = args.configurationSweep?.summary.missingProviders ?? 0
  const retrieval = args.liveResearchHud?.intelligence?.retrieval
  const providerCards = [args.dashboard?.weather, args.dashboard?.news, args.dashboard?.finance].filter(Boolean)
  const sourceHealthImprovement = providerCards.length
    ? `${providerCards.filter(card => card?.status === 'available').length}/${providerCards.length}`
    : 'pending'

  return [
    {
      label: 'Providers configured',
      value: total ? `${configured}/${total}` : 'checking',
      detail: 'Configuration Sweep readiness, env presence only.',
      color: '#38BDF8',
    },
    {
      label: 'Missing providers',
      value: args.configurationSweep ? String(missing) : 'checking',
      detail: 'Setup guidance names env vars only; no secret values.',
      color: missing > 0 ? '#FB923C' : '#34D399',
    },
    {
      label: 'Retrieval success rate',
      value: retrieval ? (retrieval.success ? '100%' : '0%') : 'idle',
      detail: retrieval ? `Source mix health: ${retrieval.health}` : 'No live retrieval run in this session.',
      color: retrieval?.success ? '#34D399' : '#FBBF24',
    },
    {
      label: 'Opportunities found',
      value: 'not connected',
      detail: 'Income Scout telemetry is preserved outside this panel until a shared stats feed exists.',
      color: '#94A3B8',
    },
    {
      label: 'Memory entries promoted',
      value: 'not connected',
      detail: 'Strategic memory promotion counts require a source-backed memory stats endpoint.',
      color: '#94A3B8',
    },
    {
      label: 'Repairs logged',
      value: 'ledger ready',
      detail: 'Repair ledger exists; live repair count is not inferred here.',
      color: '#A78BFA',
    },
    {
      label: 'Warnings resolved',
      value: String(Math.max(0, (args.liveResearchHud?.intelligence?.redTeamWarnings ?? 0) - (args.liveResearchHud?.intelligence?.unsupportedClaims ?? 0))),
      detail: 'Derived only from current intelligence metadata warnings and unsupported claims.',
      color: '#FBBF24',
    },
    {
      label: 'Source health improvement',
      value: sourceHealthImprovement,
      detail: 'Weather, RSS, and finance cards that returned source-backed data.',
      color: sourceHealthImprovement.includes('/') ? '#38BDF8' : '#94A3B8',
    },
  ]
}

function FamilyTipInline({ tip, onCouncilHandoff }: { tip: FamilyTip; onCouncilHandoff?: (decree: string) => void }) {
  return (
    <div className="mt-2 rounded border border-sky-300/10 bg-sky-950/10 p-1.5">
      <p className="text-[7px] font-bold uppercase tracking-widest text-sky-200">Family Tip · {tip.family}</p>
      <p className="mt-1 text-[9px] text-slate-200">{tip.title}</p>
      <p className="mt-1 text-[8px] leading-snug text-slate-500">{tip.insight}</p>
      <button
        type="button"
        className="mt-1 text-[7px] uppercase tracking-widest text-sky-300 underline"
        onClick={() => onCouncilHandoff?.(tip.suggested_decree)}
      >
        Ask Council
      </button>
    </div>
  )
}

function HandoffButtons({
  decree,
  onCouncilHandoff,
}: {
  decree: string
  onCouncilHandoff?: (decree: string) => void
}) {
  if (!onCouncilHandoff) return null
  const actions: { label: string; action: CouncilHandoffAction }[] = [
    { label: 'Ask Council', action: 'ask_council' },
    { label: 'Investigate', action: 'investigate' },
    { label: 'Send Analysts', action: 'send_to_analysts' },
    { label: 'Create Opp', action: 'create_opportunity' },
  ]
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {actions.map(item => (
        <button
          key={item.action}
          type="button"
          className="rounded border border-sky-300/20 px-1.5 py-0.5 text-[7px] uppercase tracking-widest text-sky-200 transition hover:border-sky-300/50 hover:text-sky-100"
          onClick={() => onCouncilHandoff(buildCouncilDecree(item.action, decree))}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export const LiveEnvironmentPanel = memo(function LiveEnvironmentPanel({
  liveResearchHud,
  location,
  horoscopeEnabled,
  astrologyMode,
  onSetLocationMode,
  onForgetLocation,
  onToggleHoroscope,
  onSetAstrologyMode,
  onCouncilHandoff,
}: {
  liveResearchHud: LiveResearchClientUi | null
  location: CommanderLocationState
  horoscopeEnabled: boolean
  astrologyMode: AstrologyInterpretationMode
  onSetLocationMode: (mode: LocationMode) => void
  onForgetLocation: () => void
  onToggleHoroscope: () => void
  onSetAstrologyMode: (mode: AstrologyInterpretationMode) => void
  onCouncilHandoff?: (decree: string) => void
}) {
  const [configurationSweep, setConfigurationSweep] = useState<ConfigurationSweep | null>(null)
  const [dashboard, setDashboard] = useState<LiveEnvironmentDashboardPayload | null>(null)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [activeNewsIndex, setActiveNewsIndex] = useState(0)
  const [activeMarketIndex, setActiveMarketIndex] = useState(0)
  const [activeStatIndex, setActiveStatIndex] = useState(0)
  const [horoscopePeriod, setHoroscopePeriod] = useState<HoroscopePeriod>('daily')
  const [reducedMotion, setReducedMotion] = useState(false)
  const weather = useMemo(
    () => dashboard?.weather ?? buildFallbackWeather(location),
    [dashboard?.weather, location],
  )
  const finance = useMemo(
    () => dashboard?.finance ?? buildFallbackFinance(),
    [dashboard?.finance],
  )
  const rssCards = dashboard?.news.cards ?? EMPTY_NEWS_CARDS
  const cards: NewsDashboardCard[] = useMemo(() => {
    const seen = new Set<string>()
    return rssCards.filter(card => {
      if (card.operationalStatus !== 'ACTIONABLE') return false
      const key = (card.url ?? card.title).toLowerCase().replace(/\s+/g, ' ').trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [rssCards])
  const activeNews = cards.length ? cards[activeNewsIndex % cards.length] : null
  const localNewsCards = useMemo(
    () => cards.filter(card => card.category === 'local' || card.category === 'regional' || /akron|summit county/i.test(`${card.title} ${card.detail}`)),
    [cards],
  )
  const sourceHealth = liveResearchHud?.intelligence?.retrieval
    ? liveResearchHud.intelligence.retrieval.success ? 'Retrieval ok' : 'Retrieval gap'
    : 'Retrieval idle'
  const weakSignals = liveResearchHud?.intelligence?.local?.weakSignalCount ?? (liveResearchHud?.intelligence?.weakSignalDetected ? 1 : 0)
  const providerById = useMemo(
    () => new Map((configurationSweep?.providers ?? []).map(provider => [provider.id, provider])),
    [configurationSweep?.providers],
  )
  const weatherProvider = providerById.get('weather_provider')
  const horoscopeProvider = providerById.get('horoscope_provider')
  const newsProvider = providerById.get('rss_news_sources')
  const financeProvider = providerById.get('finance_market_data')
  const sourceNetworkProvider = providerById.get('persistent_source_network')
  const localSourceProvider = providerById.get('local_hyperlocal_sources')
  const horoscope = useMemo(
    () => buildHoroscopeSnapshot(undefined, astrologyMode, Boolean(horoscopeProvider?.configured), horoscopePeriod),
    [astrologyMode, horoscopePeriod, horoscopeProvider?.configured],
  )
  const signalState = localSignalState({ sourceNetworkProvider, localSourceProvider, weakSignals, localCards: localNewsCards.length })
  const activeQuote = finance.quotes.length ? finance.quotes[activeMarketIndex % finance.quotes.length] : null
  const improvementStats = useMemo(
    () => statList({ configurationSweep, liveResearchHud, dashboard }),
    [configurationSweep, liveResearchHud, dashboard],
  )
  const activeStat = improvementStats[activeStatIndex % improvementStats.length]
  const liveEnvironmentTip = familyTipsForPanel('live_environment')[0]
  const commanderSuggestion = buildCommanderSuggestion({
    weather,
    finance,
    activeNews,
    signalState,
    missingProviders: configurationSweep?.summary.missingProviders ?? 0,
    pendingActions: liveResearchHud?.intelligence?.unsupportedClaims ?? 0,
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/configuration/sweep', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as ConfigurationSweep
        if (!cancelled) setConfigurationSweep(json)
      } catch {
        /* Live Environment remains usable if the read-only sweep endpoint is unavailable. */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadDashboard() {
      try {
        const res = await fetch('/api/environment/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ location }),
        })
        const json = await res.json() as LiveEnvironmentDashboardPayload | { message?: string }
        if (!res.ok) throw new Error('message' in json && json.message ? json.message : 'Live Environment dashboard unavailable')
        if (!cancelled) {
          setDashboard(json as LiveEnvironmentDashboardPayload)
          setDashboardError(null)
        }
      } catch (error) {
        if (!cancelled) setDashboardError(error instanceof Error ? error.message : 'Live Environment dashboard unavailable')
      }
    }
    void loadDashboard()
    const interval = window.setInterval(() => void loadDashboard(), 300000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [location])

  useEffect(() => {
    if (reducedMotion || cards.length <= 1) return
    const interval = window.setInterval(() => setActiveNewsIndex(prev => (prev + 1) % cards.length), 8000)
    return () => window.clearInterval(interval)
  }, [cards.length, reducedMotion])

  useEffect(() => {
    if (reducedMotion || finance.quotes.length <= 1) return
    const interval = window.setInterval(() => setActiveMarketIndex(prev => (prev + 1) % finance.quotes.length), 7000)
    return () => window.clearInterval(interval)
  }, [finance.quotes.length, reducedMotion])

  useEffect(() => {
    if (reducedMotion || improvementStats.length <= 1) return
    const interval = window.setInterval(() => setActiveStatIndex(prev => (prev + 1) % improvementStats.length), 9000)
    return () => window.clearInterval(interval)
  }, [improvementStats.length, reducedMotion])

  return (
    <section className="mx-4 mt-4 rounded border border-sky-500/20 bg-slate-950/45 px-4 py-3 font-mono shadow-[0_0_30px_rgba(56,189,248,0.08)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-sky-300">Live Environment</p>
          <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Source-backed context only; no silent precise tracking.</p>
        </div>
        <details className="rounded border border-white/10 px-2 py-1 text-[9px] text-slate-400">
          <summary className="cursor-pointer uppercase tracking-widest">{describeLocationMode(location)}</summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {(['off', 'city_only', 'neighborhood', 'precise_temporary'] as LocationMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                className="rounded px-1.5 py-0.5 text-[8px] uppercase tracking-widest"
                style={{
                  border: location.mode === mode ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.12)',
                  color: location.mode === mode ? '#7dd3fc' : '#94a3b8',
                }}
                onClick={() => onSetLocationMode(mode)}
              >
                {modeLabel(mode)}
              </button>
            ))}
            <button type="button" className="text-[8px] uppercase tracking-widest text-slate-500 underline" onClick={onForgetLocation}>
              Forget history
            </button>
          </div>
        </details>
      </div>
      <style jsx>{`
        .environment-card-motion {
          transition: opacity 420ms ease, transform 420ms ease, border-color 420ms ease;
        }
        .environment-card-motion:hover {
          transform: translateY(-1px);
          border-color: rgba(125, 211, 252, 0.35);
        }
        @media (prefers-reduced-motion: reduce) {
          .environment-card-motion {
            transition: none;
          }
          .environment-card-motion:hover {
            transform: none;
          }
        }
      `}</style>
      {dashboardError && (
        <details className="mb-2 rounded border border-amber-400/20 bg-amber-950/20 px-2 py-1 text-[9px] text-amber-200">
          <summary className="cursor-pointer uppercase tracking-widest">Live environment refresh delayed</summary>
          <p className="mt-1 text-[8px] uppercase tracking-widest text-amber-100">Dashboard route unavailable: {dashboardError}</p>
        </details>
      )}

      <div className="grid gap-2 md:grid-cols-6">
        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Weather</p>
                <p className="mt-1 text-xs text-slate-100">{weather.locationLabel}</p>
              </div>
              <span className="text-lg leading-none text-sky-200">{weatherIcon(weather.condition, weather.status)}</span>
            </div>
            <p className="mt-2 text-xl font-semibold tracking-tight text-slate-50">{formatTemp(weather.currentTempF)}</p>
            <p className="text-[10px] text-amber-100">{weatherConditionText(weather)}</p>
            <p className="mt-1 text-[9px] text-slate-400">
              H/L {formatTemp(weather.highF)}/{formatTemp(weather.lowF)} · Precip {formatPercent(weather.precipitationChance)}
            </p>
            <p className="mt-1 text-[9px] leading-snug text-slate-300">{weatherForecastSummary(weather)}</p>
            <p className="mt-2 text-[8px] uppercase tracking-widest" style={{ color: weather.status === 'available' ? providerStatusColor(weatherProvider) : weatherStateColor(weather.providerState) }}>
              {weather.status === 'available' ? `${weather.freshness} · source-backed` : 'feed paused'}
            </p>
            <HandoffButtons decree="Council, review the current Akron weather, alerts, and operating risk. Recommend any family, travel, or local timing adjustments without guessing missing data." onCouncilHandoff={onCouncilHandoff} />
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p>Status: {weather.status} · provider state: {weatherStateLabel(weather.providerState)}</p>
            <p>Provider: {weather.provider}</p>
            <p>Wind: {weather.wind ?? 'not returned'}</p>
            <p>Severe alerts: {weather.alerts.length ? `${weather.alerts.length} active` : 'none from configured source'}</p>
            <p>{weather.source} · {weather.freshness}</p>
            <p className="normal-case tracking-wide">{weather.detail}</p>
            {weather.diagnostics?.map(item => (
              <p key={item} className="normal-case tracking-wide">Diagnostic: {item}</p>
            ))}
            {weather.hourlyForecast.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-slate-400">Hourly forecast</p>
                {weather.hourlyForecast.slice(0, 4).map(point => (
                  <p key={`${point.label}-${point.tempF}`}>{point.label}: {formatTemp(point.tempF)} · {point.condition} · rain {formatPercent(point.precipitationChance)}</p>
                ))}
              </div>
            )}
            {weather.dailyForecast.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-slate-400">7-day forecast</p>
                {weather.dailyForecast.slice(0, 7).map(point => (
                  <p key={`${point.label}-${point.condition}`}>{point.label}: {formatTemp(point.tempF)} · {point.condition}</p>
                ))}
              </div>
            )}
            {weather.alerts.map(alert => (
              <p key={`${alert.title}-${alert.expiresAt}`} className="mt-1 text-amber-200">{alert.severity}: {alert.title} · {alert.source}</p>
            ))}
            <p className="normal-case tracking-wide" style={{ color: providerStatusColor(weatherProvider) }}>
              {weather.status === 'available'
                ? `Provider details: ${weather.provider}; fetched ${weather.fetchedAt ?? 'unknown'}.`
                : setupGuidanceText(weather.setup, providerSetupHint(weatherProvider, 'Weather provider setup check pending.'))}
            </p>
          </div>
        </details>

        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Commander Suggestion</p>
            <p className="mt-1 text-xs text-slate-100">{commanderSuggestion.suggestedMove}</p>
            <p className="mt-1 text-[10px] leading-snug text-slate-300">{commanderSuggestion.whyItMatters}</p>
            <p className="mt-2 text-[8px] uppercase tracking-widest text-emerald-200">{commanderSuggestion.familySource} · {commanderSuggestion.relatedPanel}</p>
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] text-slate-500">
            <p className="uppercase tracking-widest text-slate-400">Expected benefit</p>
            <p className="mt-1 leading-snug">{commanderSuggestion.expectedBenefit}</p>
            <p className="mt-2 uppercase tracking-widest text-slate-400">Next action</p>
            <p className="mt-1 leading-snug">{commanderSuggestion.nextAction}</p>
            <HandoffButtons decree={commanderSuggestion.decree} onCouncilHandoff={onCouncilHandoff} />
            {liveEnvironmentTip && <FamilyTipInline tip={liveEnvironmentTip} onCouncilHandoff={onCouncilHandoff} />}
          </div>
        </details>

        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Local Signals</p>
            <p className="mt-1 text-xs text-slate-100">Akron / Summit watch</p>
            <p className="mt-1 text-[10px] leading-snug text-slate-300">{localSignalSummary(signalState, weakSignals)}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {LOCAL_INTELLIGENCE_QUERIES.slice(0, 4).map(query => (
                <span key={query} className="rounded border border-white/10 px-1.5 py-0.5 text-[7px] uppercase tracking-widest text-slate-400">
                  {query}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(sourceNetworkProvider) }}>
              {localSignalLabel(signalState)}
            </p>
            <HandoffButtons decree="Grok, investigate Akron local news, Summit County alerts, local economy and business signals, weather alerts, public safety, traffic, and community events. Report verified, emerging, contradictions, and unknowns." onCouncilHandoff={onCouncilHandoff} />
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p>Retrieval: {sourceHealth}</p>
            <p>Weak signals: {weakSignals}</p>
            <p>Local news cards: {localNewsCards.length}</p>
            <p>Contradictions: {liveResearchHud?.intelligence?.contradictionWarnings ?? 0}</p>
            <p>Default query set: {LOCAL_INTELLIGENCE_QUERIES.join(' · ')}</p>
            <p style={{ color: providerStatusColor(sourceNetworkProvider) }}>
              Source network: {providerStatusLabel(sourceNetworkProvider)}
            </p>
            <p style={{ color: providerStatusColor(localSourceProvider) }}>
              Local feed registry: {signalState === 'feeds_online' || signalState === 'no_results_yet' ? 'covered by persistent source network' : providerStatusLabel(localSourceProvider)}
            </p>
            <p className="normal-case tracking-wide">
              Diagnostics: add trusted local RSS/API sources when you want dedicated neighborhood cards; until then, the persistent source network remains the ready local signal path when configured.
            </p>
          </div>
        </details>

        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Horoscope</p>
              <button type="button" className="text-[8px] uppercase tracking-widest text-sky-300" onClick={onToggleHoroscope}>
                {horoscopeEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-100">{horoscopePeriod[0]?.toUpperCase()}{horoscopePeriod.slice(1)} guidance</p>
            <p className="mt-1 text-[10px] leading-snug text-slate-300">{horoscopeEnabled ? horoscope.interpretation : 'Optional symbolic guidance is off.'}</p>
            <p className="mt-2 text-[8px] uppercase tracking-widest text-purple-200">
              {astrologyMode} · interpretive fallback
            </p>
            <HandoffButtons decree="Council, reflect on the current symbolic horoscope guidance as private interpretation only. Separate useful reflection from any factual or predictive claim." onCouncilHandoff={onCouncilHandoff} />
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="mb-2 flex flex-wrap gap-1">
              {HOROSCOPE_PERIODS.map(period => (
                <button
                  key={period}
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[8px] uppercase tracking-widest"
                  style={{
                    border: horoscopePeriod === period ? '1px solid #c084fc' : '1px solid rgba(255,255,255,0.12)',
                    color: horoscopePeriod === period ? '#d8b4fe' : '#94a3b8',
                  }}
                  onClick={() => setHoroscopePeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {(['spiritual', 'ancestral', 'symbolic', 'neutral', 'entertainment'] as AstrologyInterpretationMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[8px] uppercase tracking-widest"
                  style={{
                    border: astrologyMode === mode ? '1px solid #c084fc' : '1px solid rgba(255,255,255,0.12)',
                    color: astrologyMode === mode ? '#d8b4fe' : '#94a3b8',
                  }}
                  onClick={() => onSetAstrologyMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[8px] uppercase tracking-widest text-slate-500">
              <p>Period: {horoscope.period}</p>
              <p>Profile: internal config retained; hidden from primary view</p>
              <p>Provider state: {horoscope.providerState}</p>
              <p>Provider: {horoscope.provider}</p>
              <p>Moon phase: {horoscope.moonPhase ?? 'not loaded'}</p>
              <p>Planetary data: {horoscope.planetaryFacts.length ? horoscope.planetaryFacts.join(' · ') : 'not loaded'}</p>
              <p className="normal-case tracking-wide">{horoscope.framingNote}</p>
              <p className="normal-case tracking-wide" style={{ color: providerStatusColor(horoscopeProvider) }}>
                {providerSetupHint(horoscopeProvider, 'Horoscope provider setup check pending.')}
              </p>
            </div>
          </div>
        </details>

        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Market Feed</p>
            {activeQuote ? (
              <>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-100">{displaySymbol(activeQuote.symbol)}</p>
                    <p className="text-[10px] text-slate-400">{activeQuote.marketType} · {activeQuote.marketStatus ?? 'market status unavailable'}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-50">{formatPrice(activeQuote.price, activeQuote.currency)}</p>
                </div>
                <p className="mt-1 text-[10px]" style={{ color: changeColor(activeQuote.change ?? activeQuote.percentChange) }}>
                  {formatSignedNumber(activeQuote.change)} · {formatPercentMovement(activeQuote.percentChange)} · {marketDirectionText(activeQuote.direction)}
                </p>
                <p className="mt-1 text-[10px] leading-snug text-slate-300">{marketInterpretation(activeQuote)}</p>
                <p className="mt-1 text-[8px] leading-snug text-amber-100">Commander Tip: Use market signals as context, not automatic trading decisions.</p>
                <p className="mt-1 text-[8px] uppercase tracking-widest text-slate-500">{activeQuote.freshness} · watchlist rotation</p>
                <HandoffButtons decree="ChatGPT, explain current GLD, SPY, BTC, and QQQ movement as operational context only, with caution notes and no automatic trading decisions." onCouncilHandoff={onCouncilHandoff} />
              </>
            ) : (
              <p className="mt-1 text-[10px] text-slate-500">Market feed temporarily unavailable.</p>
            )}
          </summary>
          <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p style={{ color: providerStatusColor(financeProvider) }}>
              Provider status: {finance.status === 'available' ? finance.provider : providerStatusLabel(financeProvider)}
            </p>
            <p>{finance.source} · {finance.freshness}</p>
            <p className="normal-case tracking-wide">{finance.detail}</p>
            {finance.quotes.map(quote => (
              <p key={quote.symbol}>
                {displaySymbol(quote.symbol)} [{quote.marketType}] {formatPrice(quote.price, quote.currency)} · change <span style={{ color: changeColor(quote.change ?? quote.percentChange) }}>{formatSignedNumber(quote.change)} / {formatPercentMovement(quote.percentChange)}</span> · {quote.movementSummary} · market {quote.marketStatus ?? 'status not returned'} · {quote.freshness}
              </p>
            ))}
            <p className="normal-case tracking-wide" style={{ color: providerStatusColor(financeProvider) }}>
              {finance.status === 'available'
                ? `Provider details: ${finance.provider}; fetched ${finance.fetchedAt ?? 'unknown'}.`
                : setupGuidanceText(finance.setup, providerSetupHint(financeProvider, 'Finance provider setup check pending.'))}
            </p>
          </div>
        </details>

        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">News Intel</p>
            {activeNews ? (
              <div className="mt-2 overflow-hidden rounded border border-white/10 bg-slate-950/60">
                {activeNews.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={activeNews.imageUrl} alt="" className="h-16 w-full object-cover opacity-85" />
                ) : (
                  <div className="flex h-16 items-center justify-center bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.18),rgba(15,23,42,0.2))] text-[8px] uppercase tracking-widest text-slate-500">
                    Source-backed text card
                  </div>
                )}
                <div className="p-1.5">
                  {activeNews.url ? (
                    <a href={activeNews.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[9px] leading-snug text-slate-100 underline decoration-cyan-500/40 hover:text-cyan-100">
                      {activeNews.title}
                    </a>
                  ) : (
                    <p className="line-clamp-2 text-[9px] leading-snug text-slate-100">{activeNews.title}</p>
                  )}
                  <p className="mt-1 truncate text-[8px] text-slate-500">
                    {activeNews.timestampLabel}
                    {activeNews.timeIntegrityStatus === 'TIME_INTEGRITY_WARNING' ? ' · TIME INTEGRITY WARNING' : ''}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-slate-500">No source-backed news cards loaded.</p>
            )}
          </summary>
          {activeNews ? (
            <div className="mt-2 rounded border border-white/5 p-1.5">
              {activeNews.url ? (
                <a href={activeNews.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[9px] text-slate-200 underline decoration-cyan-500/40 hover:text-cyan-100">
                  {activeNews.title}
                </a>
              ) : (
                <p className="line-clamp-2 text-[9px] text-slate-200">{activeNews.title}</p>
              )}
              <p className="mt-1 truncate text-[8px] text-slate-500">
                {activeNews.timestampLabel} · {activeNews.category}
              </p>
              {activeNews.signalVerifiedAt ? (
                <p className="mt-0.5 truncate text-[7px] text-slate-600">
                  Verified {new Date(activeNews.signalVerifiedAt).toLocaleString()}
                </p>
              ) : null}
              <p className="mt-1 inline-flex rounded border border-emerald-300/20 px-1.5 py-0.5 text-[7px] uppercase tracking-widest text-emerald-200">
                {activeNews.displayLabel}
              </p>
              <p className="mt-1 text-[8px] text-slate-600">{activeNews.detail}</p>
              {activeNews.url ? (
                <a
                  href={activeNews.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex rounded border border-cyan-400/30 px-2 py-1 text-[8px] font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/10"
                >
                  Open Source
                </a>
              ) : (
                <p className="mt-2 text-[8px] uppercase tracking-widest text-slate-500">Source URL unavailable</p>
              )}
              <HandoffButtons decree={`Council, review this source-backed news signal from ${activeNews.sourceName}: ${activeNews.title}. Identify verified facts, operational relevance, contradictions, and unknowns.`} onCouncilHandoff={onCouncilHandoff} />
              {cards.length > 1 && (
                <div className="mt-2 flex gap-1">
                  {cards.slice(0, 6).map((card, index) => (
                    <button
                      key={card.id}
                      type="button"
                      aria-label={`Show news card ${index + 1}`}
                      className="h-1.5 flex-1 rounded-full"
                      style={{ background: index === activeNewsIndex % cards.length ? '#38BDF8' : 'rgba(148,163,184,0.3)' }}
                      onClick={() => setActiveNewsIndex(index)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-slate-500">
              No source-backed news cards loaded. Open diagnostics for source status.
            </p>
          )}
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p style={{ color: providerStatusColor(newsProvider) }}>
              News source: {dashboard?.news.status === 'available' ? dashboard.news.provider : providerStatusLabel(newsProvider)}
            </p>
            <p>{dashboard?.news.source ?? 'news source pending'} · {dashboard?.news.freshness ?? 'unknown'}</p>
            {dashboard?.news.fetchedAt ? (
              <p className="normal-case tracking-wide">Signal ingested at: {dashboard.news.fetchedAt}</p>
            ) : null}
            {dashboard?.news.diagnostics?.map(item => (
              <p key={item} className="normal-case tracking-wide">Diagnostic: {item}</p>
            ))}
            <p className="normal-case tracking-wide">{dashboard?.news.detail ?? setupGuidanceText(dashboard?.news.setup, providerSetupHint(newsProvider, 'News provider setup check pending.'))}</p>
          </div>
        </details>

        <div className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">War Room Evolution</p>
          <p className="mt-1 text-xs" style={{ color: activeStat.color }}>{activeStat.value}</p>
          <p className="text-[10px] text-slate-300">{activeStat.label}</p>
          <p className="mt-1 text-[8px] text-slate-600">{activeStat.detail}</p>
          <HandoffButtons decree="Council, review War Room readiness across Live Environment, Analysts, Opportunity Scout, Agent Foundry, Learning, Automation, Diagnostics, System Health, Engineering, and Memory. Recommend one safe next move." onCouncilHandoff={onCouncilHandoff} />
          <div className="mt-2 flex gap-1">
            {improvementStats.map((stat, index) => (
              <button
                key={stat.label}
                type="button"
                aria-label={`Show ${stat.label}`}
                className="h-1.5 flex-1 rounded-full"
                style={{ background: index === activeStatIndex % improvementStats.length ? stat.color : 'rgba(148,163,184,0.25)' }}
                onClick={() => setActiveStatIndex(index)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
})
