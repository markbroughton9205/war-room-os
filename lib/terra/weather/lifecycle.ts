import type { WeatherLifecycleState } from './types'

function parseMillis(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Weather lifecycle uses NWS CAP status + effective/onset/ends/expires.
 * Retrieval time and sent-age never mark an still-effective alert HISTORICAL.
 */
export function resolveWeatherLifecycle(input: {
  status: string | null | undefined
  messageType: string | null | undefined
  effective: string | null | undefined
  onset: string | null | undefined
  ends: string | null | undefined
  expires: string | null | undefined
  nowIso: string
}): WeatherLifecycleState {
  const status = (input.status ?? '').trim().toLowerCase()
  const messageType = (input.messageType ?? '').trim().toLowerCase()
  if (status === 'cancelled' || messageType === 'cancel') return 'CANCELLED'

  const now = parseMillis(input.nowIso)
  if (now == null) return 'UNKNOWN'

  const ends = parseMillis(input.ends) ?? parseMillis(input.expires)
  if (ends != null && ends <= now) return 'EXPIRED'

  const start = parseMillis(input.onset) ?? parseMillis(input.effective)
  if (start != null && start > now) return 'UPCOMING'

  if (status === 'actual' || status === 'exercise' || status === 'system' || status === '') {
    if (start == null && ends == null && !status) return 'UNKNOWN'
    return 'ACTIVE'
  }

  if (status === 'draft' || status === 'test') return 'UNKNOWN'
  return 'UNKNOWN'
}
