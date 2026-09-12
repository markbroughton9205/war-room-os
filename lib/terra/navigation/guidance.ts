/**
 * #22 Phase 9 — Map matching, off-route, instructions, ETA, traffic/incident contracts.
 */
import { bearingDegrees, distanceToPolylineMeters, haversineMeters } from './geometry'
import { NAVIGATION_DEFAULT_BOUNDS, type EtaResult, type MapMatchResult, type NavigationIncident, type NavigationInstruction, type NavigationRoute, type OffRouteState, type RoadGraph, type TrafficObservation } from './types'
import { ROAD_TRAFFIC_SOURCE_REGISTRY } from '@/lib/terra/roadTrafficSourceRegistry'

export function mapMatchLocation(
  graph: RoadGraph,
  point: { latitude: number; longitude: number },
  headingDegrees?: number | null,
): MapMatchResult {
  if (graph.segments.length === 0) {
    return {
      state: 'NO_ROAD_COVERAGE',
      matched_segment_id: null,
      distance_from_segment_meters: null,
      confidence: 'UNVERIFIED',
      heading_match: null,
      candidates: [],
      limitations: ['No road segments in graph.'],
    }
  }

  const scored = graph.segments
    .map(seg => {
      const d = distanceToPolylineMeters(point, seg.geometry)
      return { segment_id: seg.segment_id, distance_meters: d.distance_meters, segment: seg }
    })
    .sort((a, b) => a.distance_meters - b.distance_meters || a.segment_id.localeCompare(b.segment_id))

  const top = scored.slice(0, 3)
  const best = top[0]!
  const second = top[1]
  const max = NAVIGATION_DEFAULT_BOUNDS.map_match_max_meters
  const ambDelta = NAVIGATION_DEFAULT_BOUNDS.map_match_ambiguous_delta_meters

  if (best.distance_meters > max * 4) {
    return {
      state: 'NO_ROAD_COVERAGE',
      matched_segment_id: null,
      distance_from_segment_meters: best.distance_meters,
      confidence: 'LOW',
      heading_match: null,
      candidates: top.map(t => ({ segment_id: t.segment_id, distance_meters: t.distance_meters })),
      limitations: ['Nearest road beyond coverage radius.'],
    }
  }

  if (second && Math.abs(best.distance_meters - second.distance_meters) <= ambDelta && best.distance_meters <= max) {
    return {
      state: 'AMBIGUOUS',
      matched_segment_id: null,
      distance_from_segment_meters: best.distance_meters,
      confidence: 'LOW',
      heading_match: null,
      candidates: top.map(t => ({ segment_id: t.segment_id, distance_meters: t.distance_meters })),
      limitations: ['Multiple plausible segments — not claiming certainty.'],
    }
  }

  if (best.distance_meters > max) {
    return {
      state: 'NO_MATCH',
      matched_segment_id: null,
      distance_from_segment_meters: best.distance_meters,
      confidence: 'LOW',
      heading_match: null,
      candidates: top.map(t => ({ segment_id: t.segment_id, distance_meters: t.distance_meters })),
      limitations: ['No match within map-match threshold.'],
    }
  }

  let heading_match: boolean | null = null
  if (typeof headingDegrees === 'number' && Number.isFinite(headingDegrees) && best.segment.geometry.length >= 2) {
    const a = best.segment.geometry[0]!
    const b = best.segment.geometry[best.segment.geometry.length - 1]!
    const segBearing = bearingDegrees(a, b)
    const delta = Math.abs(((headingDegrees - segBearing + 540) % 360) - 180)
    heading_match = delta <= 45 || delta >= 135
  }

  const low = best.distance_meters > max * 0.6 || heading_match === false
  return {
    state: low ? 'LOW_CONFIDENCE' : 'MATCHED',
    matched_segment_id: best.segment_id,
    distance_from_segment_meters: best.distance_meters,
    confidence: low ? 'LOW' : 'HIGH',
    heading_match,
    candidates: top.map(t => ({ segment_id: t.segment_id, distance_meters: t.distance_meters })),
    limitations: [],
  }
}

export function classifyOffRoute(
  route: NavigationRoute,
  point: { latitude: number; longitude: number },
): OffRouteState {
  if (route.status !== 'OK' || route.geometry.length < 2) return 'UNKNOWN'
  const d = distanceToPolylineMeters(point, route.geometry).distance_meters
  if (d <= NAVIGATION_DEFAULT_BOUNDS.off_route_slight_meters) return 'ON_ROUTE'
  if (d <= NAVIGATION_DEFAULT_BOUNDS.off_route_hard_meters) return 'SLIGHTLY_OFF_ROUTE'
  return 'OFF_ROUTE'
}

export type RerouteTrigger =
  | 'ROUTE_CLOSURE'
  | 'MAJOR_DELAY'
  | 'OFF_ROUTE_DEVIATION'
  | 'DESTINATION_CHANGE'
  | 'EXPLICIT_USER_REQUEST'
  | 'NONE'

export function evaluateRerouteTrigger(input: {
  route: NavigationRoute
  offRoute: OffRouteState
  incidents: NavigationIncident[]
  explicitRequest?: boolean
  destinationChanged?: boolean
}): { trigger: RerouteTrigger; should_reroute: boolean; device_control: false } {
  if (input.explicitRequest) {
    return { trigger: 'EXPLICIT_USER_REQUEST', should_reroute: true, device_control: false }
  }
  if (input.destinationChanged) {
    return { trigger: 'DESTINATION_CHANGE', should_reroute: true, device_control: false }
  }
  const closedOnRoute = input.incidents.some(
    i =>
      i.closure_state === 'CLOSED' &&
      i.segment_ids.some(id => input.route.segment_ids.includes(id)),
  )
  if (closedOnRoute) {
    return { trigger: 'ROUTE_CLOSURE', should_reroute: true, device_control: false }
  }
  if (input.offRoute === 'OFF_ROUTE') {
    return { trigger: 'OFF_ROUTE_DEVIATION', should_reroute: true, device_control: false }
  }
  return { trigger: 'NONE', should_reroute: false, device_control: false }
}

export function computeEta(input: {
  route: NavigationRoute
  traffic?: TrafficObservation[]
  incidents?: NavigationIncident[]
}): EtaResult {
  const base = input.route.estimated_duration_seconds
  const inputs_used = ['route_distance', 'segment_speed_limits_or_base']
  let trafficAdj: number | null = null
  let incidentAdj: number | null = null
  let realTime = false

  const liveTraffic = (input.traffic ?? []).filter(
    t =>
      input.route.segment_ids.includes(t.segment_id) &&
      (t.freshness === 'LIVE' || t.freshness === 'DELAYED') &&
      typeof t.delay_seconds === 'number',
  )
  if (liveTraffic.length > 0) {
    trafficAdj = base + liveTraffic.reduce((s, t) => s + (t.delay_seconds ?? 0), 0)
    inputs_used.push('traffic_delay')
    realTime = liveTraffic.some(t => t.freshness === 'LIVE')
  }

  const closed = (input.incidents ?? []).filter(
    i => i.closure_state === 'CLOSED' && i.segment_ids.some(id => input.route.segment_ids.includes(id)),
  )
  if (closed.length > 0) {
    incidentAdj = (trafficAdj ?? base) + 600 * closed.length
    inputs_used.push('incident_closure_penalty')
  }

  const final = incidentAdj ?? trafficAdj ?? base
  return {
    base_eta_seconds: base,
    traffic_adjusted_eta_seconds: trafficAdj,
    incident_adjusted_eta_seconds: incidentAdj,
    final_eta_seconds: final,
    confidence: realTime ? 'MEDIUM' : 'LOW',
    inputs_used,
    real_time_claimed: realTime,
  }
}

export function buildNavigationInstructions(route: NavigationRoute, graph: RoadGraph): NavigationInstruction[] {
  if (route.status !== 'OK' || route.segment_ids.length === 0) return []
  const byId = new Map(graph.segments.map(s => [s.segment_id, s]))
  const out: NavigationInstruction[] = []
  let seq = 0
  let remaining = route.distance_meters

  for (let i = 0; i < route.segment_ids.length; i++) {
    const seg = byId.get(route.segment_ids[i]!)
    if (!seg || seg.geometry.length < 2) continue
    const a = seg.geometry[0]!
    const b = seg.geometry[seg.geometry.length - 1]!
    const bearing = bearingDegrees(a, b)
    let action: NavigationInstruction['action'] = 'CONTINUE'
    if (i === route.segment_ids.length - 1) action = 'ARRIVE'
    else if (i > 0) {
      const prev = byId.get(route.segment_ids[i - 1]!)
      if (prev && prev.geometry.length >= 2) {
        const pa = prev.geometry[0]!
        const pb = prev.geometry[prev.geometry.length - 1]!
        const prevBearing = bearingDegrees(pa, pb)
        const delta = ((bearing - prevBearing + 540) % 360) - 180
        if (delta > 35) action = 'TURN_RIGHT'
        else if (delta < -35) action = 'TURN_LEFT'
        else action = 'CONTINUE'
      }
    }
    out.push({
      instruction_id: `instr_${seq}`,
      type: action,
      road_name: seg.name,
      distance_to_action_meters: Math.max(0, Math.round(remaining)),
      action,
      bearing_degrees: bearing,
      location: a,
      segment_id: seg.segment_id,
      sequence: seq,
      confidence: 'MEDIUM',
    })
    remaining -= seg.length_meters
    seq += 1
  }

  if (out.length === 0 || out[out.length - 1]?.action !== 'ARRIVE') {
    out.push({
      instruction_id: `instr_${seq}`,
      type: 'ARRIVE',
      road_name: null,
      distance_to_action_meters: 0,
      action: 'ARRIVE',
      bearing_degrees: null,
      location: route.destination,
      segment_id: route.segment_ids[route.segment_ids.length - 1] ?? null,
      sequence: seq,
      confidence: 'MEDIUM',
    })
  }
  return out
}

/** Traffic contract + provider truth from existing road traffic registry. Live segment speeds: NOT_IMPLEMENTED. */
export function trafficProviderTruthSummary(): {
  contract: 'IMPLEMENTED'
  live_traffic: 'NOT_IMPLEMENTED'
  registered_providers: Array<{ id: string; capabilities: string[]; reconciliationStatus: string }>
  note: string
} {
  return {
    contract: 'IMPLEMENTED',
    live_traffic: 'NOT_IMPLEMENTED',
    registered_providers: ROAD_TRAFFIC_SOURCE_REGISTRY.map(r => ({
      id: r.id,
      capabilities: [...r.capabilities],
      reconciliationStatus: r.reconciliationStatus,
    })),
    note: 'Traffic contract exists; live segment-speed routing is NOT_IMPLEMENTED. Registered camera/event/flow sources ≠ live navigation traffic.',
  }
}

export function makeFixtureIncidents(nowIso = new Date().toISOString()): NavigationIncident[] {
  return [
    {
      incident_id: 'inc-closed-f',
      type: 'ROAD_CLOSED',
      segment_ids: ['seg-closed'],
      location: { latitude: 60.1732, longitude: 24.9455 },
      start_time: nowIso,
      end_time: null,
      severity: 'HIGH',
      description: 'Fixture closure on Spur F',
      closure_state: 'CLOSED',
      provider: 'fixture_incidents',
      source: 'terra_navigation_fixture',
      observed_at: nowIso,
      freshness: 'CACHED',
      confidence: 'HIGH',
    },
  ]
}

export function makeFixtureTraffic(nowIso = new Date().toISOString()): TrafficObservation[] {
  return [
    {
      segment_id: 'seg-a',
      speed_observed_kph: null,
      speed_free_flow_kph: 50,
      congestion_level: 'UNKNOWN',
      delay_seconds: null,
      observed_at: nowIso,
      provider: 'none',
      source: 'contract_only',
      freshness: 'NOT_IMPLEMENTED',
      confidence: 'UNVERIFIED',
    },
    {
      segment_id: 'seg-b',
      speed_observed_kph: 20,
      speed_free_flow_kph: 50,
      congestion_level: 'HEAVY',
      delay_seconds: 120,
      observed_at: new Date(Date.parse(nowIso) - 3_600_000).toISOString(),
      provider: 'fixture_stale_traffic',
      source: 'fixture',
      freshness: 'STALE',
      confidence: 'LOW',
    },
  ]
}

export function distanceAlongRouteRemaining(
  route: NavigationRoute,
  point: { latitude: number; longitude: number },
): number | null {
  if (route.status !== 'OK' || route.geometry.length < 2) return null
  // Approximate: distance from point to destination along remaining polyline length after closest point
  return Math.round(haversineMeters(point, route.destination))
}
