import type { EarthPulseCoverage, EarthPulseTruthState } from './types'
import {
  EARTH_PULSE_AURORA_LIVE_MS,
  EARTH_PULSE_LIGHTNING_LIVE_MS,
  EARTH_PULSE_LIGHTNING_RECENT_MS,
  EARTH_PULSE_LIVE_MAX_AGE_MS,
  EARTH_PULSE_RECENT_MAX_AGE_MS,
} from './types'

export function ageMs(observedAt: string | null, nowIso: string): number | null {
  if (!observedAt) return null
  const observed = Date.parse(observedAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return null
  return now - observed
}

export function classifyFreshness(input: {
  observedAt: string | null
  nowIso: string
  liveMaxMs?: number
  recentMaxMs?: number
  hasCoverage: boolean
  hasItems: boolean
  fetchOk: boolean
}): EarthPulseTruthState {
  if (!input.hasCoverage) return 'NO_COVERAGE'
  if (!input.fetchOk) return 'UNAVAILABLE'
  const age = ageMs(input.observedAt, input.nowIso)
  if (age === null) return input.hasItems ? 'RECENT' : 'UNAVAILABLE'
  if (age < 0) return 'STALE'
  const liveMax = input.liveMaxMs ?? EARTH_PULSE_LIVE_MAX_AGE_MS
  const recentMax = input.recentMaxMs ?? EARTH_PULSE_RECENT_MAX_AGE_MS
  if (age <= liveMax) return 'LIVE'
  if (age <= recentMax) return 'RECENT'
  return 'STALE'
}

export function classifyLightningFreshness(observedAt: string | null, nowIso: string, fetchOk: boolean, inCoverage: boolean): EarthPulseTruthState {
  if (!inCoverage) return 'NO_COVERAGE'
  return classifyFreshness({
    observedAt,
    nowIso,
    liveMaxMs: EARTH_PULSE_LIGHTNING_LIVE_MS,
    recentMaxMs: EARTH_PULSE_LIGHTNING_RECENT_MS,
    hasCoverage: true,
    hasItems: true,
    fetchOk,
  })
}

export function classifyAuroraFreshness(observedAt: string | null, nowIso: string, fetchOk: boolean): EarthPulseTruthState {
  if (!fetchOk) return 'UNAVAILABLE'
  const age = ageMs(observedAt, nowIso)
  if (age === null) return 'UNAVAILABLE'
  // OVATION's Forecast Time can be minutes ahead of now. That is still the current nowcast, not stale.
  if (age < 0 && Math.abs(age) <= EARTH_PULSE_AURORA_LIVE_MS) return 'LIVE'
  return classifyFreshness({
    observedAt,
    nowIso,
    liveMaxMs: EARTH_PULSE_AURORA_LIVE_MS,
    recentMaxMs: 6 * 60 * 60_000,
    hasCoverage: true,
    hasItems: true,
    fetchOk,
  })
}

/** Daily / annual products are never LIVE, even when just retrieved. */
export function classifyArchivalOrDaily(kind: 'daily' | 'annual' | 'unavailable', fetchOk: boolean): EarthPulseTruthState {
  if (!fetchOk || kind === 'unavailable') return 'UNAVAILABLE'
  if (kind === 'annual') return 'STALE'
  return 'RECENT'
}

export function coverage(input: {
  kind: EarthPulseCoverage['kind']
  label: string
  west?: number | null
  south?: number | null
  east?: number | null
  north?: number | null
  basis: string
}): EarthPulseCoverage {
  return {
    kind: input.kind,
    label: input.label,
    west: input.west ?? null,
    south: input.south ?? null,
    east: input.east ?? null,
    north: input.north ?? null,
    basis: input.basis,
  }
}

export function noneCoverage(basis: string): EarthPulseCoverage {
  return coverage({ kind: 'none', label: 'No coverage this phase', basis })
}

export function globalCoverage(basis: string): EarthPulseCoverage {
  return coverage({ kind: 'global', label: 'Global', west: -180, south: -90, east: 180, north: 90, basis })
}
