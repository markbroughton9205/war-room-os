import type { WeatherAlert, WeatherDedupeRecord, WeatherToastCandidate } from './types'
import { meetsWeatherToastSeverity } from './severityGate'

export const WEATHER_DEDUPE_STORAGE_KEY = 'terra-weather-alert-dedupe'
export const WEATHER_MUTE_STORAGE_KEY = 'terra-weather-alerts-muted'

export function weatherAlertFingerprint(alert: WeatherAlert): string {
  return [
    alert.severity ?? '',
    alert.urgency ?? '',
    alert.certainty ?? '',
    alert.status ?? '',
    alert.messageType ?? '',
    alert.sent ?? '',
    alert.updated ?? '',
    alert.expires ?? '',
    alert.ends ?? '',
    alert.headline ?? '',
    alert.event ?? '',
  ].join('|')
}

export function ingestWeatherAlerts(input: {
  alerts: WeatherAlert[]
  records: Record<string, WeatherDedupeRecord>
  nowIso: string
  muted: boolean
}): {
  records: Record<string, WeatherDedupeRecord>
  toasts: WeatherToastCandidate[]
} {
  const records = { ...input.records }
  const toasts: WeatherToastCandidate[] = []
  if (input.muted) {
    for (const alert of input.alerts) {
      const existing = records[alert.id]
      records[alert.id] = {
        id: alert.id,
        firstSeen: existing?.firstSeen ?? input.nowIso,
        lastSeen: input.nowIso,
        lastNotifiedAt: existing?.lastNotifiedAt ?? null,
        lastFingerprint: existing?.lastFingerprint ?? weatherAlertFingerprint(alert),
      }
    }
    return { records, toasts }
  }

  for (const alert of input.alerts) {
    if (!meetsWeatherToastSeverity(alert)) continue
    const fingerprint = weatherAlertFingerprint(alert)
    const existing = records[alert.id]
    if (!existing) {
      records[alert.id] = {
        id: alert.id,
        firstSeen: input.nowIso,
        lastSeen: input.nowIso,
        lastNotifiedAt: input.nowIso,
        lastFingerprint: fingerprint,
      }
      toasts.push({ alert, kind: 'new' })
      continue
    }
    records[alert.id] = {
      ...existing,
      lastSeen: input.nowIso,
    }
    if (existing.lastFingerprint && existing.lastFingerprint !== fingerprint) {
      records[alert.id] = {
        ...records[alert.id],
        lastNotifiedAt: input.nowIso,
        lastFingerprint: fingerprint,
      }
      toasts.push({ alert, kind: 'updated' })
    }
  }

  return { records, toasts }
}

export function pickWeatherToast(toasts: WeatherToastCandidate[]): WeatherToastCandidate | null {
  if (toasts.length === 0) return null
  const rank = (severity: string | null) => {
    const value = severity?.toLowerCase()
    if (value === 'extreme') return 3
    if (value === 'severe') return 2
    return 1
  }
  return [...toasts].sort((a, b) => {
    const severityDelta = rank(b.alert.severity) - rank(a.alert.severity)
    if (severityDelta !== 0) return severityDelta
    return (b.alert.sent ?? b.alert.effective ?? '').localeCompare(a.alert.sent ?? a.alert.effective ?? '')
  })[0] ?? null
}
