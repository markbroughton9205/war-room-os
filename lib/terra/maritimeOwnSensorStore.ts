import 'server-only'

/**
 * In-memory own-sensor AIS observation store.
 * AIS-catcher / local SDR → POST /api/terra/own-sensor/ais → this ring buffer → Terra.
 * Process-local only; empty means no receiver is feeding this runtime (NEEDS_LOCAL_SENSOR).
 */
import type { TerraOwnSensorAisObservation } from '@/lib/terra/maritimeOwnSensorBridge'

const MAX_OBSERVATIONS = 500
const FRESH_MS = 15 * 60 * 1000

const byMmsi = new Map<number, TerraOwnSensorAisObservation>()

export function ingestOwnSensorAisObservations(observations: TerraOwnSensorAisObservation[]): number {
  let stored = 0
  for (const observation of observations) {
    if (!Number.isFinite(observation.mmsi) || !Number.isFinite(observation.latitude) || !Number.isFinite(observation.longitude)) continue
    if (observation.latitude < -90 || observation.latitude > 90 || observation.longitude < -180 || observation.longitude > 180) continue
    byMmsi.set(observation.mmsi, observation)
    stored += 1
  }
  if (byMmsi.size > MAX_OBSERVATIONS) {
    const sorted = [...byMmsi.entries()].sort((a, b) => Date.parse(a[1].observedAtIso) - Date.parse(b[1].observedAtIso))
    for (const [mmsi] of sorted.slice(0, byMmsi.size - MAX_OBSERVATIONS)) byMmsi.delete(mmsi)
  }
  return stored
}

export function listOwnSensorAisObservations(nowMs = Date.now()): TerraOwnSensorAisObservation[] {
  const fresh: TerraOwnSensorAisObservation[] = []
  for (const observation of byMmsi.values()) {
    const observedMs = Date.parse(observation.observedAtIso)
    if (Number.isFinite(observedMs) && nowMs - observedMs <= FRESH_MS) fresh.push(observation)
  }
  return fresh
}

export function ownSensorHasFreshFeed(nowMs = Date.now()): boolean {
  return listOwnSensorAisObservations(nowMs).length > 0
}

export function __resetOwnSensorStoreForTests(): void {
  byMmsi.clear()
}
