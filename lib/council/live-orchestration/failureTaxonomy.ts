import type { CouncilFailureLayer } from './types'

export function classifyProviderFailure(input: {
  httpStatus?: number | 'timeout' | 'unavailable'
  message?: string
  abortReason?: string
  parserError?: boolean
  persistenceError?: boolean
  orchestratorError?: boolean
  visibleTokensEmitted?: boolean
}): CouncilFailureLayer {
  if (input.persistenceError) return 'PERSISTENCE'
  if (input.orchestratorError) return 'ORCHESTRATOR'
  if (input.parserError) return 'STREAM_PARSER'
  const status = input.httpStatus
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 'timeout' || input.abortReason === 'first_token' || input.abortReason === 'idle' || input.abortReason === 'overall') {
    return 'TIMEOUT'
  }
  const msg = (input.message ?? '').toLowerCase()
  if (/auth|api key|invalid.?key|unauthorized|incorrect api key/.test(msg)) return 'AUTH'
  if (/credit|billing|balance|purchase credits|too many tokens.*billing/.test(msg)) return 'BILLING'
  if (/rate limit|too many requests/.test(msg)) return 'RATE_LIMIT'
  if (/quota/.test(msg) && !/credit|billing/.test(msg)) return 'RATE_LIMIT'
  if (/context.?length|max.?tokens|too many tokens|overflow/.test(msg)) return 'REQUEST'
  if (/network|fetch failed|econnreset|socket|dns/.test(msg)) return 'TRANSPORT'
  if (typeof status === 'number' && status >= 500) return 'PROVIDER'
  if (status === 400 && /credit|billing|balance/.test(msg)) return 'BILLING'
  if (typeof status === 'number' && status >= 400) return 'REQUEST'
  if (status === 'unavailable') return 'PROVIDER'
  return 'UNKNOWN'
}

export function failureUiLabel(familyLabel: string, layer: CouncilFailureLayer, reason?: string): string {
  const compact = reason ? `${familyLabel} · FAILED · ${layer}` : `${familyLabel} · FAILED`
  return reason ? `${compact} — ${reason}` : compact
}

export function retryableBeforeVisibleToken(layer: CouncilFailureLayer, httpStatus?: number | 'timeout' | 'unavailable'): boolean {
  if (layer === 'AUTH' || layer === 'BILLING' || layer === 'REQUEST' || layer === 'PERSISTENCE' || layer === 'UI') return false
  if (httpStatus === 401 || httpStatus === 403) return false
  if (layer === 'RATE_LIMIT' || layer === 'TIMEOUT' || layer === 'TRANSPORT' || layer === 'PROVIDER') return true
  if (typeof httpStatus === 'number' && httpStatus >= 500) return true
  return false
}
