/**
 * Hazard counter semantics for Terra's top bar. Counters represent feed truth from live-intel
 * provider status — never default zeros, never a missing layer treated as 0 events.
 *
 * UNAVAILABLE / AUTH_REQUIRED / RATE_LIMITED display as "—" not 0.
 * A healthy empty NHC snapshot is a legitimate 0.
 * Volcanoes stay PARTIAL (EONET named events) and are never labeled global live coverage.
 * NASA FIRMS detections are active-fire / thermal-anomaly observations, never auto-labeled wildfires.
 */
import type { TerraLiveFreshness, TerraLiveProviderStatus } from './liveGeoIntelligence'

export type TerraHazardHealth = 'HEALTHY' | 'STALE' | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'PARTIAL'

export type TerraHazardCounter = {
  id: string
  label: string
  value: number | null
  displayValue: string
  coverage: string
  provider: string
  freshness: TerraLiveFreshness | 'NEAR_REALTIME'
  lastUpdated: string | null
  health: TerraHazardHealth
  detail: string
  refreshIntervalMs: number
}

const FAIL_FRESHNESS: ReadonlySet<string> = new Set([
  'UNAVAILABLE',
  'AUTH_FAILED',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'NOT_CONFIGURED',
  'NEEDS_CREDENTIALS',
  'NOT_IMPLEMENTED',
  'DISABLED',
])

export function healthFromFreshness(
  freshness: TerraLiveFreshness,
  coveragePartial: boolean,
  ageMs: number | null = null,
  refreshIntervalMs: number | null = null,
): TerraHazardHealth {
  if (freshness === 'AUTH_REQUIRED' || freshness === 'NEEDS_CREDENTIALS' || freshness === 'NOT_CONFIGURED') return 'AUTH_REQUIRED'
  if (freshness === 'RATE_LIMITED') return 'RATE_LIMITED'
  if (freshness === 'UNAVAILABLE' || freshness === 'AUTH_FAILED' || freshness === 'NOT_IMPLEMENTED' || freshness === 'DISABLED') return 'UNAVAILABLE'
  if (freshness === 'STALE' || freshness === 'HISTORICAL') return 'STALE'
  const cacheWithinWindow = (freshness === 'CACHED' || freshness === 'DELAYED')
    && ageMs !== null
    && refreshIntervalMs !== null
    && Number.isFinite(ageMs)
    && ageMs >= 0
    && ageMs <= refreshIntervalMs
  if ((freshness === 'CACHED' || freshness === 'DELAYED') && !cacheWithinWindow) return 'STALE'
  if (coveragePartial) return 'PARTIAL'
  return 'HEALTHY'
}

function providerById(providers: TerraLiveProviderStatus[], id: string): TerraLiveProviderStatus | null {
  return providers.find(row => row.id === id) ?? null
}

function counterFromProvider(input: {
  id: string
  label: string
  providerId: string
  providers: TerraLiveProviderStatus[]
  coverage: string
  providerLabel: string
  refreshIntervalMs: number
  lastUpdated: string | null
  coveragePartial?: boolean
  zeroIsLegitimate?: boolean
  missingMeans?: TerraLiveFreshness
  forceAuthRequired?: boolean
}): TerraHazardCounter {
  const row = providerById(input.providers, input.providerId)
  const ageMs = input.lastUpdated ? Date.now() - Date.parse(input.lastUpdated) : null
  const age = ageMs !== null && Number.isFinite(ageMs) ? ageMs : null
  if (input.forceAuthRequired) {
    return {
      id: input.id,
      label: input.label,
      value: null,
      displayValue: '—',
      coverage: input.coverage,
      provider: input.providerLabel,
      freshness: row?.freshness === 'LIVE' ? 'NEAR_REALTIME' : (row?.freshness ?? 'AUTH_REQUIRED'),
      lastUpdated: input.lastUpdated,
      health: 'AUTH_REQUIRED',
      detail: row?.reason ?? 'NASA FIRMS MAP_KEY required. Detections are thermal anomalies, not automatically wildfires.',
      refreshIntervalMs: input.refreshIntervalMs,
    }
  }
  if (!row) {
    const freshness = input.missingMeans ?? 'UNAVAILABLE'
    const health = healthFromFreshness(freshness, Boolean(input.coveragePartial), age, input.refreshIntervalMs)
    const failed = FAIL_FRESHNESS.has(freshness) || health === 'UNAVAILABLE' || health === 'AUTH_REQUIRED' || health === 'RATE_LIMITED'
    return {
      id: input.id,
      label: input.label,
      value: failed ? null : 0,
      displayValue: failed ? '—' : '0',
      coverage: input.coverage,
      provider: input.providerLabel,
      freshness,
      lastUpdated: input.lastUpdated,
      health,
      detail: `${input.providerLabel} did not appear in the live-intel snapshot.`,
      refreshIntervalMs: input.refreshIntervalMs,
    }
  }

  const freshness = row.freshness
  const health = healthFromFreshness(freshness, Boolean(input.coveragePartial), age, input.refreshIntervalMs)
  const failed = FAIL_FRESHNESS.has(freshness)
  const value = failed ? null : row.objectCount
  const showDash = value === null || (failed && !input.zeroIsLegitimate)
  const displayFreshness: TerraHazardCounter['freshness'] = health === 'HEALTHY' && (freshness === 'CACHED' || freshness === 'DELAYED' || freshness === 'EMPTY')
    ? 'LIVE'
    : freshness
  return {
    id: input.id,
    label: input.label,
    value,
    displayValue: showDash ? '—' : String(value ?? 0),
    coverage: input.coverage,
    provider: input.providerLabel,
    freshness: displayFreshness,
    lastUpdated: input.lastUpdated,
    health,
    detail: row.reason,
    refreshIntervalMs: input.refreshIntervalMs,
  }
}

export function composeTerraHazardCounters(input: {
  providers: TerraLiveProviderStatus[]
  fetchedAt: string | null
}): TerraHazardCounter[] {
  const lastUpdated = input.fetchedAt
  const firms = providerById(input.providers, 'nasa_firms')
  const firmsAuthRequired = !firms || firms.freshness === 'AUTH_REQUIRED' || firms.freshness === 'NEEDS_CREDENTIALS' || firms.configurationState !== 'ENABLED'

  return [
    counterFromProvider({
      id: 'earthquakes',
      label: 'EARTHQUAKES',
      providerId: 'usgs_earthquake_feed',
      providers: input.providers,
      coverage: 'USGS M4.5+ day feed (global catalog)',
      providerLabel: 'USGS',
      refreshIntervalMs: 60_000,
      lastUpdated,
      zeroIsLegitimate: true,
    }),
    counterFromProvider({
      id: 'cyclones',
      label: 'CYCLONES',
      providerId: 'nhc_current_storms',
      providers: input.providers,
      coverage: 'NHC basins AL/EP/CP — not JTWC West Pacific',
      providerLabel: 'NHC',
      refreshIntervalMs: 5 * 60_000,
      lastUpdated,
      zeroIsLegitimate: true,
    }),
    counterFromProvider({
      id: 'severe',
      label: 'TORNADO/SEVERE',
      providerId: 'nws_severe_weather_alerts',
      providers: input.providers,
      coverage: 'NWS CAP US — watches are not confirmed tornadoes',
      providerLabel: 'NWS',
      refreshIntervalMs: 120_000,
      lastUpdated,
      zeroIsLegitimate: true,
    }),
    counterFromProvider({
      id: 'fires',
      label: 'FIRES',
      providerId: 'nasa_firms',
      providers: input.providers,
      coverage: 'NASA FIRMS thermal anomaly — not auto-labeled wildfire',
      providerLabel: 'NASA FIRMS',
      refreshIntervalMs: 10 * 60_000,
      lastUpdated,
      forceAuthRequired: firmsAuthRequired,
    }),
    counterFromProvider({
      id: 'volcanoes',
      label: 'VOLCANOES',
      providerId: 'nasa_eonet_volcanoes',
      providers: input.providers,
      coverage: 'PARTIAL — EONET named events (Smithsonian GVP), not a global USGS alert-level feed',
      providerLabel: 'NASA EONET',
      refreshIntervalMs: 10 * 60_000,
      lastUpdated,
      coveragePartial: true,
      zeroIsLegitimate: true,
    }),
  ]
}

export function formatHazardUpdated(lastUpdated: string | null, nowMs: number = Date.now()): string {
  if (!lastUpdated) return 'updated unknown'
  const then = Date.parse(lastUpdated)
  if (!Number.isFinite(then)) return 'updated unknown'
  const deltaSec = Math.max(0, Math.round((nowMs - then) / 1000))
  if (deltaSec < 60) return `updated ${deltaSec}s ago`
  const deltaMin = Math.round(deltaSec / 60)
  if (deltaMin < 60) return `updated ${deltaMin}m ago`
  return `updated ${Math.round(deltaMin / 60)}h ago`
}
