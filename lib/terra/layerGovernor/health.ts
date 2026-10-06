import {
  GOVERNOR_RETRY_BACKOFF_MS,
  GOVERNOR_RETRY_FAILURES,
  type ProviderHealth,
} from './types'

export function classifyProviderHealth(input: {
  truth?: string
  state?: string
  authRequired?: boolean
}): ProviderHealth {
  if (input.authRequired) return 'AUTH_REQUIRED'
  const token = (input.truth ?? input.state ?? '').toUpperCase()
  if (token === 'AUTH_REQUIRED' || token === 'AUTH_FAIL') return 'AUTH_REQUIRED'
  if (token === 'LIVE' || token === 'RECENT' || token === 'AVAILABLE' || token === 'HEALTHY') return 'HEALTHY'
  if (token === 'STALE' || token === 'RATE_LIMITED' || token === 'DEGRADED' || token === 'PARTIAL') return 'DEGRADED'
  if (token === 'NO_COVERAGE') return 'HEALTHY'
  return 'OFFLINE'
}

export function providerRetryAllowed(input: {
  health: ProviderHealth
  consecutiveFailures: number
  lastAttemptMs: number | null
  nowMs: number
}): boolean {
  if (input.health === 'AUTH_REQUIRED') return false
  if (input.consecutiveFailures < GOVERNOR_RETRY_FAILURES) return true
  if (input.lastAttemptMs == null) return true
  return input.nowMs - input.lastAttemptMs >= GOVERNOR_RETRY_BACKOFF_MS
}
