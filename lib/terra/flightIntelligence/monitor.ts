import { aircraftMatchesClass } from './classification'
import type { AircraftClass, FlightSearchKind, TerraAircraftTruth } from './types'

export type FlightMonitorFilter =
  | 'ALL'
  | 'WATCHED'
  | 'MILITARY'
  | 'STRATEGIC'
  | 'GOVERNMENT'
  | 'COMMERCIAL'
  | 'CARGO'
  | 'SPECIAL_MISSION'
  | 'NEARBY'

const FILTER_CLASS: Partial<Record<FlightMonitorFilter, AircraftClass>> = {
  MILITARY: 'MILITARY',
  STRATEGIC: 'STRATEGIC',
  GOVERNMENT: 'GOVERNMENT',
  COMMERCIAL: 'COMMERCIAL',
  CARGO: 'CARGO',
  SPECIAL_MISSION: 'SPECIAL_MISSION',
}

export function filterFlightMonitor(
  aircraft: readonly TerraAircraftTruth[],
  filter: FlightMonitorFilter,
  nearbyKeys: ReadonlySet<string> = new Set(),
): TerraAircraftTruth[] {
  return aircraft.filter(item => {
    if (filter === 'ALL') return true
    if (filter === 'WATCHED') return item.watched
    if (filter === 'NEARBY') return nearbyKeys.has(item.identity.key)
    const aircraftClass = FILTER_CLASS[filter]
    return aircraftClass ? aircraftMatchesClass(item.classification, aircraftClass) : false
  })
}

export type WatchRule =
  | { kind: 'icao'; hex: string }
  | { kind: 'registration'; registration: string }
  | { kind: 'type'; icaoType: string }
  | { kind: 'class'; aircraftClass: AircraftClass }

export function watchKey(rule: WatchRule): string {
  if (rule.kind === 'icao') return rule.hex.toLowerCase()
  if (rule.kind === 'registration') return `reg:${rule.registration.toUpperCase()}`
  if (rule.kind === 'type') return `type:${rule.icaoType.toUpperCase()}`
  return `class:${rule.aircraftClass}`
}

export function aircraftMatchesWatch(aircraft: TerraAircraftTruth, rules: readonly WatchRule[]): boolean {
  return rules.some(rule => {
    if (rule.kind === 'icao') return aircraft.identity.icaoHex === rule.hex.toLowerCase()
    if (rule.kind === 'registration') return (aircraft.identity.registration ?? '').toUpperCase() === rule.registration.toUpperCase()
    if (rule.kind === 'type') return aircraft.classification.icaoType === rule.icaoType.toUpperCase()
    return aircraft.classification.classes.includes(rule.aircraftClass)
  })
}

export type FlightAlertKind =
  | 'WATCHED_AIRCRAFT_VISIBLE'
  | 'WATCHED_TYPE_VISIBLE'
  | 'AIRCRAFT_LOST'
  | 'PROVIDER_DEGRADED'
  | 'POSITION_STALE'
  | 'EMERGENCY_STATUS'

export type FlightAlert = { id: string; kind: FlightAlertKind; aircraftKey: string | null; detail: string }

export function flightAlerts(previous: readonly TerraAircraftTruth[], next: readonly TerraAircraftTruth[]): FlightAlert[] {
  const before = new Map(previous.map(item => [item.identity.key, item]))
  const alerts: FlightAlert[] = []
  for (const item of next) {
    const prior = before.get(item.identity.key)
    if (item.watched && !prior) {
      const typeWatch = item.classification.id !== null
      alerts.push({
        id: `${typeWatch ? 'WATCHED_TYPE_VISIBLE' : 'WATCHED_AIRCRAFT_VISIBLE'}:${item.identity.key}`,
        kind: typeWatch ? 'WATCHED_TYPE_VISIBLE' : 'WATCHED_AIRCRAFT_VISIBLE',
        aircraftKey: item.identity.key,
        detail: item.identity.icaoHex ?? item.identity.key,
      })
    }
    if (prior && prior.freshness !== 'STALE' && item.freshness === 'STALE') {
      alerts.push({ id: `POSITION_STALE:${item.identity.key}`, kind: 'POSITION_STALE', aircraftKey: item.identity.key, detail: item.qualityReason })
    }
    if (prior && !prior.primary?.emergency && item.primary?.emergency && item.primary.emergency !== 'none') {
      alerts.push({ id: `EMERGENCY_STATUS:${item.identity.key}`, kind: 'EMERGENCY_STATUS', aircraftKey: item.identity.key, detail: item.primary.emergency })
    }
  }
  for (const item of previous) {
    if (!next.some(candidate => candidate.identity.key === item.identity.key) && item.watched) {
      alerts.push({ id: `AIRCRAFT_LOST:${item.identity.key}`, kind: 'AIRCRAFT_LOST', aircraftKey: item.identity.key, detail: item.identity.key })
    }
  }
  return alerts
}

const HEX_QUERY = /^[0-9a-fA-F]{6}$/
const REG_QUERY = /^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$/i

export function classifyFlightSearch(query: string): { kind: FlightSearchKind; normalized: string } | null {
  const text = query.trim()
  if (!text) return null
  if (/^watch\b/i.test(text)) return { kind: 'WATCHLIST', normalized: text }
  if (HEX_QUERY.test(text)) return { kind: 'AIRCRAFT', normalized: text.toLowerCase() }
  if (/^type\s+[A-Z0-9]{2,4}$/i.test(text)) return { kind: 'AIRCRAFT_TYPE', normalized: text.split(/\s+/)[1].toUpperCase() }
  if (REG_QUERY.test(text) && /[A-Z]/i.test(text) && /\d/.test(text)) return { kind: 'AIRCRAFT', normalized: text.toUpperCase() }
  return null
}
