'use client'

import { useEffect, useState } from 'react'

import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { ConfigurationSweep } from '@/lib/configuration/configurationHealth'
import type { ProviderConfigStatus } from '@/lib/configuration/providerConfigStatus'
import type { CommanderLocationState, LocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { describeLocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { buildWeatherEnvironmentSnapshot } from '@/lib/intelligence/environment/weatherEnvironment'
import { buildHoroscopeSnapshot, type AstrologyInterpretationMode } from '@/lib/intelligence/environment/horoscopeEnvironment'
import { buildNewsCardsFromIntelligence } from '@/lib/intelligence/environment/newsCards'

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

function providerSetupHint(provider: ProviderConfigStatus | undefined, fallback: string): string {
  if (!provider) return fallback
  const envNames = [...provider.requiredEnvVars, ...provider.optionalEnvVars].join(', ') || 'no env vars registered'
  if (provider.status === 'ready' || provider.status === 'configured') {
    return `${provider.name}: configured. ${provider.lastCheckResult}`
  }
  return `${provider.name}: ${provider.recommendedNextAction} Env names: ${envNames}.`
}

export function LiveEnvironmentPanel({
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
  const weather = buildWeatherEnvironmentSnapshot(location)
  const horoscope = buildHoroscopeSnapshot('Aries', new Date(), astrologyMode)
  const cards = buildNewsCardsFromIntelligence(liveResearchHud?.intelligence)
  const sourceHealth = liveResearchHud?.intelligence?.retrieval
    ? liveResearchHud.intelligence.retrieval.success ? 'Retrieval ok' : 'Retrieval gap'
    : 'Retrieval idle'
  const weakSignals = liveResearchHud?.intelligence?.local?.weakSignalCount ?? (liveResearchHud?.intelligence?.weakSignalDetected ? 1 : 0)
  const providerById = new Map((configurationSweep?.providers ?? []).map(provider => [provider.id, provider]))
  const weatherProvider = providerById.get('weather_provider')
  const horoscopeProvider = providerById.get('horoscope_provider')
  const newsProvider = providerById.get('rss_news_sources')
  const sourceNetworkProvider = providerById.get('persistent_source_network')
  const localSourceProvider = providerById.get('local_hyperlocal_sources')

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

      <div className="grid gap-2 md:grid-cols-5">
        <details className="rounded border border-white/10 bg-black/25 p-2">
          <summary className="cursor-pointer list-none">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Weather</p>
            <p className="mt-1 text-xs text-slate-200">{weather.locationLabel}</p>
            <p className="text-[10px] text-amber-200">{weather.condition}</p>
            <p className="mt-1 text-[9px] text-slate-500">Temp -- · High/Low -- · Rain --</p>
            <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(weatherProvider) }}>
              {providerStatusLabel(weatherProvider)}
            </p>
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p>Hourly report unavailable</p>
            <p>Severe alerts: {weather.alertActive ? 'active' : 'none from configured source'}</p>
            <p>{weather.source} · {weather.freshness}</p>
            <p className="normal-case tracking-wide">{weather.detail}</p>
            <p className="normal-case tracking-wide" style={{ color: providerStatusColor(weatherProvider) }}>
              {providerSetupHint(weatherProvider, 'Weather provider setup check pending.')}
            </p>
          </div>
        </details>

        <div className="rounded border border-white/10 bg-black/25 p-2">
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

        <div className="rounded border border-white/10 bg-black/25 p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Signals</p>
          <p className="mt-1 text-xs text-slate-200">{sourceHealth}</p>
          <p className="text-[10px] text-slate-500">Weak signals: {weakSignals}</p>
          <p className="text-[10px] text-slate-500">
            Contradictions: {liveResearchHud?.intelligence?.contradictionWarnings ?? 0}
          </p>
          <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(sourceNetworkProvider) }}>
            Source network: {providerStatusLabel(sourceNetworkProvider)}
          </p>
          <p className="text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(localSourceProvider) }}>
            Local sources: {providerStatusLabel(localSourceProvider)}
          </p>
        </div>

        <details className="rounded border border-white/10 bg-black/25 p-2">
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
              {providerStatusLabel(horoscopeProvider)}
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
              <p>Date: {horoscope.date}</p>
              <p>Provider: {horoscope.provider}</p>
              <p>Moon phase: {horoscope.moonPhase ?? 'not loaded'}</p>
              <p>Planetary data: {horoscope.planetaryFacts.length ? horoscope.planetaryFacts.join(' · ') : 'not loaded'}</p>
              <p className="normal-case tracking-wide" style={{ color: providerStatusColor(horoscopeProvider) }}>
                {providerSetupHint(horoscopeProvider, 'Horoscope provider setup check pending.')}
              </p>
            </div>
          </div>
        </details>

        <div className="rounded border border-white/10 bg-black/25 p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">News Cards</p>
          <p className="mt-1 text-[8px] uppercase tracking-widest" style={{ color: providerStatusColor(newsProvider) }}>
            RSS/news: {providerStatusLabel(newsProvider)}
          </p>
          {cards.length ? (
            <div className="mt-1 space-y-1">
              {cards.map(card => (
                <details key={card.id} className="rounded border border-white/5 px-1.5 py-1">
                  <summary className="cursor-pointer list-none">
                    <p className="truncate text-[9px] text-slate-200">{card.title}</p>
                    <p className="truncate text-[8px] text-slate-500">{card.sourceName} · {card.badge}</p>
                  </summary>
                  <p className="mt-1 text-[8px] text-slate-600">{card.detail}</p>
                </details>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-slate-500">
              No source-backed image cards loaded. {providerSetupHint(newsProvider, 'News provider setup check pending.')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
