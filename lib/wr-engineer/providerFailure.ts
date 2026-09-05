/**
 * WR-Engineer Phase 5 — normalize local and external provider failures into Commander-visible
 * classes. Never treats a missing answer as success. Never echoes credentials.
 */

export const PROVIDER_FAILURE_CLASSES = [
  'rate_limited',
  'auth_unavailable',
  'timeout',
  'billing_unavailable',
  'unavailable',
  'unknown',
] as const
export type ProviderFailureClass = (typeof PROVIDER_FAILURE_CLASSES)[number]

export type ProviderHealthStatus = 'READY' | 'RATE_LIMITED' | 'UNAVAILABLE'

export function classifyProviderFailure(
  error: string | undefined,
  transportStatus?: number | 'timeout' | 'unavailable' | string,
): ProviderFailureClass {
  const text = (error ?? '').toLowerCase()
  if (transportStatus === 'timeout' || transportStatus === 408 || transportStatus === 504) return 'timeout'
  if (/\b(timeout|timed out|aborted|aborterror)\b/.test(text)) return 'timeout'
  if (transportStatus === 429 || /\b(429|rate limit|too many requests|quota exceeded|session limit)\b/.test(text)) return 'rate_limited'
  if (transportStatus === 401 || transportStatus === 403 || /\b(401|403|unauthorized|forbidden|invalid api key|authentication failed|not configured)\b/.test(text)) {
    return 'auth_unavailable'
  }
  if (/\b(billing|payment required|credit|payment_required|402)\b/.test(text)) return 'billing_unavailable'
  if (transportStatus === 'unavailable' || /\b(unreachable|econnrefused|enotfound|unavailable|not pulled|no models)\b/.test(text)) return 'unavailable'
  if (!text.trim()) return 'unknown'
  return 'unknown'
}

export function providerHealthFromFailure(failure: ProviderFailureClass | null, configured: boolean): ProviderHealthStatus {
  if (!configured) return 'UNAVAILABLE'
  if (failure === 'rate_limited') return 'RATE_LIMITED'
  if (failure === 'auth_unavailable' || failure === 'billing_unavailable' || failure === 'unavailable' || failure === 'timeout') {
    return 'UNAVAILABLE'
  }
  return 'READY'
}
