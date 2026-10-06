import { classificationFromObservation } from './classification'
import { resolveAircraftIdentity } from './identity'
import { freshnessFromAge, observationAgeSec, selectPrimaryObservation, validPosition } from './quality'
import type { AircraftProviderObservation, ProviderHealthState, TerraAircraftTruth } from './types'

export function federateAircraftObservations(
  observations: readonly AircraftProviderObservation[],
  nowMs: number,
  watchedKeys: ReadonlySet<string> = new Set(),
  sessionSeen: ReadonlyMap<string, { first: string; last: string }> = new Map(),
): TerraAircraftTruth[] {
  const groups = new Map<string, AircraftProviderObservation[]>()
  const identities = new Map<string, ReturnType<typeof resolveAircraftIdentity>>()
  for (const observation of observations) {
    const identity = resolveAircraftIdentity(observation)
    identities.set(identity.key, identity)
    const bucket = groups.get(identity.key) ?? []
    bucket.push(observation)
    groups.set(identity.key, bucket)
  }
  const aircraft: TerraAircraftTruth[] = []
  for (const [key, group] of groups) {
    const identity = identities.get(key)!
    const selected = selectPrimaryObservation(group, nowMs)
    const primary = selected.primary
    const age = primary ? observationAgeSec(primary, nowMs) : null
    const seen = sessionSeen.get(key)
    aircraft.push({
      identity: {
        ...identity,
        registration: primary?.registration ?? identity.registration,
      },
      primary,
      alternates: selected.alternates,
      classification: classificationFromObservation(primary),
      freshness: primary ? freshnessFromAge(age, validPosition(primary)) : 'POSITION_UNAVAILABLE',
      qualityReason: selected.reason,
      alternateSourceCount: selected.alternates.length,
      sessionFirstSeen: seen?.first ?? primary?.receivedAt ?? null,
      sessionLastSeen: primary?.receivedAt ?? seen?.last ?? null,
      watched: watchedKeys.has(key) || (identity.icaoHex !== null && watchedKeys.has(identity.icaoHex)),
    })
  }
  aircraft.sort((left, right) => left.identity.key.localeCompare(right.identity.key))
  return aircraft
}

export function providerDidNotKillOthers(states: readonly ProviderHealthState[]): boolean {
  return states.some(state => state.state === 'LIVE' || state.state === 'RECENT' || state.observationCount > 0)
}
