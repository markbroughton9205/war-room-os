export { pulsarConsumeDiscovery, pulsarConsumeAssessments } from '@/lib/council/engines/integration/pulsar'
export { pulsarSelectTool, pulsarCompileContext } from '@/lib/council/engines/integration/executionRoles'

export type PulsarSource = {
  url: string
  retrieved_at: string
  primary: boolean
  recency: 'current' | 'background' | 'stale'
}

export function pulsarSourceQuality(sources: readonly PulsarSource[], requireMulti = true): {
  ok: boolean
  independent: number
  reason: string
} {
  const current = sources.filter(row => row.recency === 'current' && row.url)
  const unique = new Set(current.map(row => row.url.replace(/\/+$/, '')))
  if (!current.length) return { ok: false, independent: 0, reason: 'No dated current sources.' }
  if (requireMulti && unique.size < 2) return { ok: false, independent: unique.size, reason: 'Multi-source verification required; one URL is not independent corroboration.' }
  if (!current.some(row => row.primary)) return { ok: false, independent: unique.size, reason: 'No primary source.' }
  return { ok: true, independent: unique.size, reason: 'Current primary sources present.' }
}

export function pulsarUncitedCurrentClaim(claim: string, sources: readonly PulsarSource[]): boolean {
  return /\b(today|currently|right now|this week)\b/i.test(claim) && sources.length === 0
}
