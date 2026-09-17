import { DEFAULT_WEATHER_TOAST_SEVERITIES, type WeatherAlert } from './types'

export function normalizeWeatherSeverity(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  const match = DEFAULT_WEATHER_TOAST_SEVERITIES.find(item => item.toLowerCase() === raw.toLowerCase())
  if (match) return match
  if (/^moderate$/i.test(raw)) return 'Moderate'
  if (/^minor$/i.test(raw)) return 'Minor'
  if (/^unknown$/i.test(raw)) return 'Unknown'
  return raw
}

export function meetsWeatherToastSeverity(
  alert: Pick<WeatherAlert, 'severity' | 'lifecycle'>,
  threshold: readonly string[] = DEFAULT_WEATHER_TOAST_SEVERITIES,
): boolean {
  if (alert.lifecycle !== 'ACTIVE') return false
  const severity = normalizeWeatherSeverity(alert.severity)
  if (!severity) return false
  return threshold.some(item => item.toLowerCase() === severity.toLowerCase())
}
