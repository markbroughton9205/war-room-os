import type { CouncilFailureLayer } from './types'
import { retryableBeforeVisibleToken } from './failureTaxonomy'

export const MAX_TRANSIENT_RETRIES_BEFORE_VISIBLE_TOKEN = 1

export function shouldRetryProviderAttempt(input: {
  attempt: number
  visibleTokensEmitted: boolean
  layer: CouncilFailureLayer
  httpStatus?: number | 'timeout' | 'unavailable'
}): boolean {
  if (input.visibleTokensEmitted) return false
  if (input.attempt >= MAX_TRANSIENT_RETRIES_BEFORE_VISIBLE_TOKEN + 1) return false
  return retryableBeforeVisibleToken(input.layer, input.httpStatus)
}

export function retryAfterMs(httpStatus?: number | 'timeout' | 'unavailable', retryAfterHeader?: string | null): number {
  if (httpStatus === 429) {
    const header = Number(retryAfterHeader)
    if (Number.isFinite(header) && header >= 0) return Math.min(header * 1000, 8_000)
    return 1_500
  }
  return 400
}
