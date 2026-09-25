import { ENGINE_01_POLICY_VERSION } from '../types'
import { identityKey } from '@/lib/browser-broker/researchPolicy'

const cache = new Map<string, { assessment: import('./types').SourceAssessment; expires: number }>()

export function assessmentCacheKey(input: {
  identity: string
  content_hash?: string | null
  freshness_window_days: number | null
  prompt_fingerprint: string
}): string {
  return [
    ENGINE_01_POLICY_VERSION,
    input.identity,
    input.content_hash || 'no-hash',
    input.freshness_window_days == null ? 'no-window' : `w${input.freshness_window_days}`,
    input.prompt_fingerprint,
  ].join('|')
}

export function readAssessmentCache(key: string): import('./types').SourceAssessment | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expires < Date.now()) {
    cache.delete(key)
    return null
  }
  return hit.assessment
}

export function writeAssessmentCache(key: string, assessment: import('./types').SourceAssessment, ttlMs = 10 * 60_000): void {
  cache.set(key, { assessment, expires: Date.now() + ttlMs })
}

export function clearAssessmentCache(): void {
  cache.clear()
}

export function identityFromUrl(url: string): string {
  return identityKey(url)
}
