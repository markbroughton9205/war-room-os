'use client'

import type { LiveResearchClientUi } from '@/lib/runtime/liveResearchEvidencePacket'
import type { CommanderLocationState, LocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { describeLocationMode } from '@/lib/intelligence/environment/locationPolicy'
import { buildWeatherEnvironmentSnapshot } from '@/lib/intelligence/environment/weatherEnvironment'
import { buildHoroscopeSnapshot } from '@/lib/intelligence/environment/horoscopeEnvironment'
import { buildNewsCardsFromIntelligence } from '@/lib/intelligence/environment/newsCards'

function modeLabel(mode: LocationMode): string {
  if (mode === 'city_only') return 'City'
  if (mode === 'precise_temporary') return 'Precise temp'
  return mode.replace(/_/g, ' ')
}

export function LiveEnvironmentPanel({
  liveResearchHud,
  location,
  horoscopeEnabled,
  onSetLocationMode,
  onForgetLocation,
  onToggleHoroscope,
}: {
  liveResearchHud: LiveResearchClientUi | null
  location: CommanderLocationState
  horoscopeEnabled: boolean
  onSetLocationMode: (mode: LocationMode) => void
  onForgetLocation: () => void
  onToggleHoroscope: () => void
}) {
  const weather = buildWeatherEnvironmentSnapshot(location)
  const horoscope = buildHoroscopeSnapshot()
  const cards = buildNewsCardsFromIntelligence(liveResearchHud?.intelligence)
  const sourceHealth = liveResearchHud?.intelligence?.retrieval
    ? liveResearchHud.intelligence.retrieval.success ? 'Retrieval ok' : 'Retrieval gap'
    : 'Retrieval idle'
  const weakSignals = liveResearchHud?.intelligence?.local?.weakSignalCount ?? (liveResearchHud?.intelligence?.weakSignalDetected ? 1 : 0)

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
          </summary>
          <div className="mt-2 border-t border-white/10 pt-2 text-[8px] uppercase tracking-widest text-slate-500">
            <p>Hourly report unavailable</p>
            <p>Severe alerts: {weather.alertActive ? 'active' : 'none from configured source'}</p>
            <p>{weather.source} · {weather.freshness}</p>
            <p className="normal-case tracking-wide">{weather.detail}</p>
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
        </div>

        <div className="rounded border border-white/10 bg-black/25 p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Horoscope</p>
            <button type="button" className="text-[8px] uppercase tracking-widest text-sky-300" onClick={onToggleHoroscope}>
              {horoscopeEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-300">{horoscopeEnabled ? horoscope.interpretation : 'Optional symbolic widget off.'}</p>
          <p className="mt-1 text-[8px] text-slate-600">Symbolic, not verified prediction.</p>
        </div>

        <div className="rounded border border-white/10 bg-black/25 p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">News Cards</p>
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
            <p className="mt-1 text-[10px] text-slate-500">No source-backed image cards loaded.</p>
          )}
        </div>
      </div>
    </section>
  )
}
