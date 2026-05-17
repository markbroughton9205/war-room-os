'use client'

import { memo, useEffect, useMemo, useState } from 'react'

import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { ConfigurationSweep } from '@/lib/configuration/configurationHealth'
import type { ProviderConfigStatus } from '@/lib/configuration/providerConfigStatus'
import type { CommanderLocationState, LocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { describeLocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { buildHoroscopeSnapshot, type AstrologyInterpretationMode } from '@/lib/intelligence/environment/horoscopeEnvironment'
import { buildNewsCardsFromIntelligence } from '@/lib/intelligence/environment/newsCards'
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

const EMPTY_NEWS_CARDS: NewsDashboardCard[] = []

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
  if (direction === 'up') return 'up'
  if (direction === 'down') return 'down'
  if (direction === 'flat') return 'flat'
  return 'movement not returned'
}

function localSignalState(args: {
  sourceNetworkProvider: ProviderConfigStatus | undefined
  localSourceProvider: ProviderConfigStatus | undefined
  weakSignals: number
}): 'source_network_ready' | 'local_feed_registry_missing' | 'no_local_results_yet' | 'provider_missing' {
  if (args.weakSignals === 0 && isProviderReady(args.sourceNetworkProvider)) return 'no_local_results_yet'
  if (isProviderReady(args.sourceNetworkProvider)) return 'source_network_ready'
  if (args.localSourceProvider?.status === 'missing_provider') return 'local_feed_registry_missing'
  return 'provider_missing'
}

function localSignalLabel(state: ReturnType<typeof localSignalState>): string {
  return state.replaceAll('_', ' ')
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

export const LiveEnvironmentPanel = memo(function LiveEnvironmentPanel({
  liveResearchHud,
  location,
  horoscopeEnabled,
  astrologyMode,
  onSetLocationMode,
  onForgetLocation,
  onToggleHoroscope,
  onSetAstrologyMode,
}: {
  liveResearchHud: LiveResearchClientUi | null
  location: CommanderLocationState
  horoscopeEnabled: boolean
  astrologyMode: AstrologyInterpretationMode
  onSetLocationMode: (mode: LocationMode) => void
  onForgetLocation: () => void
  onToggleHoroscope: () => void
  onSetAstrologyMode: (mode: AstrologyInterpretationMode) => void
}) {
  const [configurationSweep, setConfigurationSweep] = useState<ConfigurationSweep | null>(null)
  const [dashboard, setDashboard] = useState<LiveEnvironmentDashboardPayload | null>(null)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [activeNewsIndex, setActiveNewsIndex] = useState(0)
  const [activeStatIndex, setActiveStatIndex] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const weather = useMemo(
    () => dashboard?.weather ?? buildFallbackWeather(location),
    [dashboard?.weather, location],
  )
  const finance = useMemo(
    () => dashboard?.finance ?? buildFallbackFinance(),
    [dashboard?.finance],
  )
  const intelligenceCards = useMemo(
    () => buildNewsCardsFromIntelligence(liveResearchHud?.intelligence),
    [liveResearchHud?.intelligence],
  )
  const rssCards = dashboard?.news.cards ?? EMPTY_NEWS_CARDS
  const cards: NewsDashboardCard[] = useMemo(() => rssCards.length
    ? rssCards
    : intelligenceCards.map(card => ({
        id: card.id,
        title: card.title,
        url: null,
        sourceName: card.sourceName,
        category: 'national',
        imageUrl: card.imageUrl ?? null,
        publishedAt: null,
        freshness: card.timestampLabel,
        confidenceLabel: card.badge,
        signalLabel: card.badge === 'weak_signal' ? 'weak-signal' : card.badge === 'verified' || card.badge === 'corroborated' ? 'verified' : 'emerging',
        detail: card.detail,
      })), [intelligenceCards, rssCards])
  const activeNews = cards.length ? cards[activeNewsIndex % cards.length] : null
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
    () => buildHoroscopeSnapshot(undefined, astrologyMode, Boolean(horoscopeProvider?.configured)),
    [astrologyMode, horoscopeProvider?.configured],
  )
  const signalState = localSignalState({ sourceNetworkProvider, localSourceProvider, weakSignals })
  const improvementStats = useMemo(
    () => statList({ configurationSweep, liveResearchHud, dashboard }),
    [configurationSweep, liveResearchHud, dashboard],
  )
  const activeStat = improvementStats[activeStatIndex % improvementStats.length]

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
        <span className="rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-400">
          {describeLocationMode(location)}
        </span>
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
        <p className="mb-2 rounded border border-amber-400/20 bg-amber-950/20 px-2 py-1 text-[9px] uppercase tracking-widest text-amber-200">
          Dashboard route unavailable: {dashboardError}
        </p>
      )}

      <div className="grid gap-2 md:grid-cols-6">
        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Weather</p>
            <p className="mt-1 text-xs text-slate-200">{weather.locationLabel}</p>
            <p className="text-[10px] text-amber-200">{weather.condition}</p>
            <p className="mt-1 text-[9px] text-slate-500">
              Temp {formatTemp(weather.currentTempF)} · High/Low {formatTemp(weather.highF)}/{formatTemp(weather.lowF)} · Rain {formatPercent(weather.precipitationChance)}
            </p>
            <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: weather.status === 'available' ? providerStatusColor(weatherProvider) : weatherStateColor(weather.providerState) }}>
              {weather.status === 'available' ? weather.provider : weatherStateLabel(weather.providerState)}
            </p>
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p>Wind: {weather.wind ?? 'not returned'}</p>
            <p>Severe alerts: {weather.alerts.length ? `${weather.alerts.length} active` : 'none from configured source'}</p>
            <p>{weather.source} · {weather.freshness}</p>
            <p className="normal-case tracking-wide">{weather.detail}</p>
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

        <div className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Track Me</p>
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
          </div>
          <button type="button" className="mt-2 text-[8px] uppercase tracking-widest text-slate-500 underline" onClick={onForgetLocation}>
            Forget location history
          </button>
        </div>

        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Signals</p>
            <p className="mt-1 text-xs text-slate-200">{sourceHealth}</p>
            <p className="text-[10px] text-slate-500">Weak signals: {weakSignals}</p>
            <p className="text-[10px] text-slate-500">
              Contradictions: {liveResearchHud?.intelligence?.contradictionWarnings ?? 0}
            </p>
            <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(sourceNetworkProvider) }}>
              {localSignalLabel(signalState)}
            </p>
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p style={{ color: providerStatusColor(sourceNetworkProvider) }}>
              Source network: {providerStatusLabel(sourceNetworkProvider)}
            </p>
            <p style={{ color: providerStatusColor(localSourceProvider) }}>
              Local feed registry: {signalState === 'source_network_ready' || signalState === 'no_local_results_yet' ? 'covered by persistent source network' : providerStatusLabel(localSourceProvider)}
            </p>
            <p className="normal-case tracking-wide">
              Setup guidance: add trusted local RSS/API sources to the local feed registry when you want dedicated neighborhood cards; until then, the persistent source network remains the ready local signal path.
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
            <p className="mt-1 text-[10px] text-slate-300">{horoscopeEnabled ? horoscope.interpretation : 'Optional astrology widget off.'}</p>
            <p className="mt-1 text-[8px] text-slate-600">{horoscope.framingNote}</p>
            <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(horoscopeProvider) }}>
              {horoscope.providerState === 'configured_adapter_pending' ? 'configured, adapter pending' : providerStatusLabel(horoscopeProvider)}
            </p>
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2">
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
              <p>Sign: {horoscope.sign}</p>
              <p>Birth: {horoscope.date} · {horoscope.birthTime} · {horoscope.birthPlace}</p>
              <p>Provider: {horoscope.provider}</p>
              <p>Moon phase: {horoscope.moonPhase ?? 'not loaded'}</p>
              <p>Planetary data: {horoscope.planetaryFacts.length ? horoscope.planetaryFacts.join(' · ') : 'not loaded'}</p>
              <p className="normal-case tracking-wide" style={{ color: providerStatusColor(horoscopeProvider) }}>
                {providerSetupHint(horoscopeProvider, 'Horoscope provider setup check pending.')}
              </p>
            </div>
          </div>
        </details>

        <details className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Market Feed</p>
            <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(financeProvider) }}>
              {finance.status === 'available' ? finance.provider : providerStatusLabel(financeProvider)}
            </p>
            {finance.quotes[0] ? (
              <>
                <p className="mt-1 text-xs text-slate-200">{finance.quotes[0].symbol}</p>
                <p className="text-[10px]" style={{ color: changeColor(finance.quotes[0].change) }}>
                  {formatPrice(finance.quotes[0].price, finance.quotes[0].currency)} · {finance.quotes[0].change ?? '--'} · {formatPercent(finance.quotes[0].percentChange)}
                </p>
                <p className="mt-1 text-[8px] text-slate-500">{marketDirectionText(finance.quotes[0].direction)} · {finance.quotes[0].freshness}</p>
              </>
            ) : (
              <p className="mt-1 text-[10px] text-slate-500">No live quotes loaded.</p>
            )}
          </summary>
          <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p>{finance.source} · {finance.freshness}</p>
            <p className="normal-case tracking-wide">{finance.detail}</p>
            {finance.quotes.map(quote => (
              <p key={quote.symbol}>
                {quote.symbol} [{quote.marketType}] {formatPrice(quote.price, quote.currency)} · change <span style={{ color: changeColor(quote.change) }}>{quote.change ?? '--'} / {formatPercent(quote.percentChange)}</span> · {quote.movementSummary} · market {quote.marketStatus ?? 'status not returned'} · {quote.freshness}
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
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">News Slideshow</p>
            <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(newsProvider) }}>
              News: {dashboard?.news.status === 'available' ? dashboard.news.provider : providerStatusLabel(newsProvider)}
            </p>
            {activeNews ? (
              <p className="mt-2 line-clamp-2 text-[9px] text-slate-200">{activeNews.title}</p>
            ) : (
              <p className="mt-1 text-[10px] text-slate-500">No source-backed news cards loaded.</p>
            )}
          </summary>
          {activeNews ? (
            <div className="mt-2 rounded border border-white/5 p-1.5">
              {activeNews.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeNews.imageUrl} alt="" className="mb-1 h-16 w-full rounded object-cover opacity-85" />
              ) : (
                <div className="mb-1 flex h-16 items-center justify-center rounded border border-dashed border-white/10 text-[8px] uppercase tracking-widest text-slate-600">
                  Text card; no source image
                </div>
              )}
              <p className="line-clamp-2 text-[9px] text-slate-200">{activeNews.title}</p>
              <p className="mt-1 truncate text-[8px] text-slate-500">
                {activeNews.sourceName} · {activeNews.freshness} · {activeNews.confidenceLabel} · {activeNews.signalLabel}
              </p>
              <p className="mt-1 text-[8px] text-slate-600">{activeNews.detail}</p>
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
              No source-backed news cards loaded. {setupGuidanceText(dashboard?.news.setup, providerSetupHint(newsProvider, 'News provider setup check pending.'))}
            </p>
          )}
        </details>

        <div className="environment-card-motion rounded border border-white/10 bg-black/25 p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">War Room Evolution</p>
          <p className="mt-1 text-xs" style={{ color: activeStat.color }}>{activeStat.value}</p>
          <p className="text-[10px] text-slate-300">{activeStat.label}</p>
          <p className="mt-1 text-[8px] text-slate-600">{activeStat.detail}</p>
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
