export function freshnessEmphasis(truth: string | null | undefined): number {
  const token = (truth ?? '').toUpperCase()
  if (token === 'LIVE') return 1
  if (token === 'AVAILABLE' || token === 'RECENT') return 0.9
  if (token === 'STALE' || token === 'DEGRADED' || token === 'PARTIAL') return 0.45
  if (isExpiredTruth(token)) return 0
  return 1
}

export function isExpiredTruth(truth: string | null | undefined): boolean {
  const token = (truth ?? '').toUpperCase()
  return token === 'EXPIRED'
    || token.includes('UNAVAILABLE FOR SELECTED TIME')
    || token === 'UNAVAILABLE_FOR_SELECTED_TIME'
}
