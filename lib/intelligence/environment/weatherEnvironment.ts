import type { CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'

export type WeatherEnvironmentStatus = 'unavailable' | 'city_estimate' | 'source_backed'

export type WeatherEnvironmentSnapshot = {
  status: WeatherEnvironmentStatus
  locationLabel: string
  currentTempF: number | null
  condition: string
  highF: number | null
  lowF: number | null
  precipitationChance: number | null
  alertActive: boolean
  source: string
  freshness: string
  detail: string
}

export function buildWeatherEnvironmentSnapshot(location: CommanderLocationState): WeatherEnvironmentSnapshot {
  const locationLabel =
    location.mode === 'off'
      ? 'Location off'
      : location.neighborhood && location.mode === 'neighborhood'
        ? location.neighborhood
        : location.city ?? 'City not set'

  return {
    status: 'unavailable',
    locationLabel,
    currentTempF: null,
    condition: 'Weather provider not configured',
    highF: null,
    lowF: null,
    precipitationChance: null,
    alertActive: false,
    source: 'No weather API configured',
    freshness: 'unknown',
    detail:
      location.mode === 'precise_temporary'
        ? 'Precise weather requires an approved provider and temporary permission.'
        : 'City-level weather is allowed by default, but no source-backed weather adapter is configured.',
  }
}
