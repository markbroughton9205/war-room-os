import { meaningfulStateFingerprint } from './core'
import type { DiscoveryOpportunity } from './types'

const observed = new Map<string, string>()

export function detectNewOrChanged(records: DiscoveryOpportunity[]): { newMatches: DiscoveryOpportunity[]; unchanged: number } {
  const newMatches: DiscoveryOpportunity[] = []
  let unchanged = 0
  for (const record of records) {
    const fingerprint = meaningfulStateFingerprint(record)
    if (observed.get(record.id) === fingerprint) unchanged += 1
    else { observed.set(record.id, fingerprint); newMatches.push(record) }
  }
  return { newMatches, unchanged }
}

export function __resetDiscoveryStateForTests(): void { observed.clear() }
export function discoveryPersistenceState() { return { persistence: 'session_only' as const, durableAvailable: false, migrationRequired: true } }
